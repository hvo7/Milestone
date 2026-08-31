/**
 * Milestone on your phone: this computer hands the app to it over your Wi-Fi.
 *
 * There is no account and no server anywhere else, which rules out the usual
 * answer of "sign in on both". The folder sync in cloudSync.cjs doesn't reach a
 * phone either — a browser can't read the OneDrive folder. So the desktop app
 * *is* the server: it serves the built app on the local network and exchanges
 * the same sync documents the folder carries.
 *
 * Serving the app itself, rather than pointing the phone at the hosted copy, is
 * not incidental. A page loaded over HTTPS cannot talk to http://192.168.x.x —
 * the browser blocks it as mixed content — so the hosted page could never reach
 * this. Loaded from here, the app and the sync API share an origin, and it works
 * with no certificate, no tunnel and no hosting.
 *
 * The protocol is the one the folder already uses: a device only ever writes its
 * own document, everyone reads the others, and the renderer reconciles with the
 * per-slot vector clocks in src/lib/cloudSync.ts. The phone is simply another
 * peer, so it inherits that conflict handling rather than needing its own.
 */
const { app } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DOC_SUFFIX = '.milestone-sync.json';
/** Documents live in the profile, not in a cloud folder: this channel has to
 *  work whether or not folder sync was ever set up. */
const docsDir = () => path.join(app.getPath('userData'), 'phone-sync');
const configPath = () => path.join(app.getPath('userData'), 'phone-config.json');

let server = null;
let listening = null;   // { port, token, urls } while running
let onDocsChanged = () => {};

// ── Config ────────────────────────────────────────────────────────────────────

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

/**
 * The token is minted once and kept. It isn't a login — it is the difference
 * between "anything on this network can read your tasks" and "the device you
 * showed the link to can". Everyone already on your Wi-Fi is the threat model,
 * which is small but not nothing.
 */
function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch { saved = {}; }
  let minted = false;
  if (!saved.token) { saved.token = crypto.randomBytes(9).toString('base64url'); minted = true; }
  if (!saved.port)  { saved.port = 4785; minted = true; }
  const config = { enabled: false, ...saved };
  if (minted) { try { writeConfig(config); } catch { /* read-only profile — carry on in memory */ } }
  return config;
}

function setConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  try { writeConfig(next); } catch { /* as above */ }
  return next;
}

// ── The document store ────────────────────────────────────────────────────────

function readDocs(exceptDeviceId) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(docsDir()); } catch { return out; }
  for (const name of names) {
    if (!name.endsWith(DOC_SUFFIX)) continue;
    if (exceptDeviceId && name === exceptDeviceId + DOC_SUFFIX) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(docsDir(), name), 'utf8'));
      if (doc && doc._milestoneSync) out.push(doc);
    } catch { /* a half-written file — skip it; the writer will finish */ }
  }
  return out;
}

function writeDoc(doc) {
  if (!doc || !doc.deviceId) return { ok: false, error: 'A document with no device id.' };
  try {
    fs.mkdirSync(docsDir(), { recursive: true });
    const target = path.join(docsDir(), doc.deviceId + DOC_SUFFIX);
    const temp = path.join(docsDir(), '.' + doc.deviceId + '.tmp');
    // Written aside and renamed, so a reader never catches a half-written file.
    fs.writeFileSync(temp, JSON.stringify(doc), 'utf8');
    fs.renameSync(temp, target);
    onDocsChanged();
    return { ok: true, at: new Date().toISOString() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function writeBackup(name, bundle) {
  try {
    const dir = path.join(docsDir(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || 'device.json').replace(/[^\w.-]/g, '_');
    fs.writeFileSync(path.join(dir, safe), JSON.stringify(bundle), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Serving the app ───────────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const distDir = () => path.join(__dirname, '..', 'dist');

/** A request for a build artefact, as opposed to a stray route the shell should
 *  answer. Answering one of these with HTML is worse than answering with a 404 —
 *  see the fallback below. */
const isAssetRequest = rel => /^assets\//.test(rel) || /\.(js|css|map|json|webmanifest)$/i.test(rel);

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const root = distDir();
  const file = path.join(root, rel);
  // Never outside dist: a device on the network must not be able to walk the disk.
  if (!file.startsWith(root)) { res.writeHead(403).end('Not allowed.'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // A missing *asset* is a real 404. It used to get the shell back, at status
      // 200 and typed text/html — so a phone asking for a chunk that had been
      // rebuilt under it received a page of HTML where a module was expected, the
      // import rejected, and the app unmounted to a blank screen. A 404 tells the
      // app the truth, and it reloads onto the current build (src/lib/lazyChunk.ts).
      if (isAssetRequest(rel)) { res.writeHead(404, { 'Content-Type': TYPES['.txt'] }).end('Not found.'); return; }
      // Anything else falls back to the app shell. Routing is hash-based, so this
      // is only reached by a stray URL and the app can sort it out from there.
      fs.readFile(path.join(root, 'index.html'), (shellErr, shell) => {
        if (shellErr) { res.writeHead(404).end('Milestone has not been built yet.'); return; }
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }).end(shell);
      });
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // The shell names the hashed files, so it must be revalidated every load or
    // the phone keeps asking for a build this computer no longer has. Everything
    // else carries its hash in its name and can be kept forever.
    const cache = rel === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache }).end(data);
  });
}

const json = (res, status, body) =>
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      // A profile is small; anything this large is a mistake or an attack.
      if (size > 12 * 1024 * 1024) { reject(new Error('Too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res, token) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  if (!route.startsWith('/api/')) { serveStatic(res, route); return; }

  // Answered without the token, so the app can tell whether a Milestone desktop
  // served it. It says nothing about your data.
  if (route === '/api/health') { json(res, 200, { ok: true, app: 'milestone' }); return; }

  const sent = url.searchParams.get('t') || req.headers['x-milestone-token'];
  if (sent !== token) { json(res, 401, { ok: false, error: 'Wrong or missing token.' }); return; }

  if (route === '/api/peers' && req.method === 'GET') {
    json(res, 200, { ok: true, peers: readDocs(url.searchParams.get('deviceId') || '') });
    return;
  }
  if (route === '/api/write' && req.method === 'POST') {
    try { json(res, 200, writeDoc(await readBody(req))); }
    catch (err) { json(res, 400, { ok: false, error: err.message }); }
    return;
  }
  if (route === '/api/backup' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      json(res, 200, writeBackup(body && body.name, body && body.bundle));
    } catch (err) { json(res, 400, { ok: false, error: err.message }); }
    return;
  }
  json(res, 404, { ok: false, error: 'No such endpoint.' });
}

/** Every address the phone could reach this computer on. */
function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net && net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function start() {
  if (listening) return Promise.resolve({ ok: true, ...listening });
  const config = loadConfig();
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      handle(req, res, config.token).catch(err => json(res, 500, { ok: false, error: err.message }));
    });
    server.on('error', err => {
      server = null;
      const error = err.code === 'EADDRINUSE'
        ? 'Port ' + config.port + ' is already in use. Pick another one.'
        : err.message;
      resolve({ ok: false, error });
    });
    server.listen(config.port, () => {
      listening = {
        port: config.port,
        token: config.token,
        urls: addresses().map(ip => 'http://' + ip + ':' + config.port + '/?t=' + config.token),
      };
      resolve({ ok: true, ...listening });
    });
  });
}

function stop() {
  if (server) { server.close(); server = null; }
  listening = null;
  return { ok: true };
}

function status() {
  const config = loadConfig();
  return {
    available: true,
    enabled: !!listening,
    port: config.port,
    token: config.token,
    urls: listening ? listening.urls : [],
    // Serving needs a build on disk. In `electron:dev` there isn't one, and
    // saying so beats handing the phone a 404.
    built: fs.existsSync(path.join(distDir(), 'index.html')),
  };
}

/** Lets main.cjs wake the renderer when a document arrives from the phone, the
 *  same way a file landing in the sync folder does. */
const onChange = fn => { onDocsChanged = fn; };

module.exports = { loadConfig, setConfig, start, stop, status, readDocs, writeDoc, writeBackup, onChange };
