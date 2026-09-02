/**
 * Milestone relay — the always-on meeting point.
 *
 * Run this anywhere that stays up (a $0 container host, a Raspberry Pi, a VPS)
 * and both the desktop and the phone can hand documents to each other without
 * ever being online at the same time. It also serves the app itself, so the
 * phone installs Milestone from here and works offline from then on.
 *
 * It is deliberately dumb, and that is the security argument as much as the
 * simplicity one: it stores one opaque document per device, hands them back, and
 * has no idea what a task is. Every decision about whose data wins still happens
 * on your devices (src/lib/cloudSync.ts). A relay that merged would be a relay
 * you had to trust with the answer.
 *
 *   node server/relay.mjs
 *
 *   MILESTONE_TOKEN   required — the shared key; must match what the app is told
 *   PORT              default 8787
 *   MILESTONE_DATA    default ./relay-data — where documents are kept
 *   MILESTONE_DIST    default ../dist — the built app to serve
 *
 * No dependencies: node:http and the standard library, so it runs on any Node 18+
 * with nothing installed.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.MILESTONE_TOKEN || '';
const PORT = Number(process.env.PORT || 8787);
const DATA = path.resolve(process.env.MILESTONE_DATA || path.join(here, '..', 'relay-data'));
const DIST = path.resolve(process.env.MILESTONE_DIST || path.join(here, '..', 'dist'));

if (!TOKEN) {
  console.error('Refusing to start without MILESTONE_TOKEN — an open relay is your whole profile, readable by anyone who finds it.');
  process.exit(1);
}

const DOC_SUFFIX = '.milestone-sync.json';
fs.mkdirSync(DATA, { recursive: true });

// ── Documents ─────────────────────────────────────────────────────────────────

function readDocs(exceptDeviceId) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(DATA); } catch { return out; }
  for (const name of names) {
    if (!name.endsWith(DOC_SUFFIX)) continue;
    if (exceptDeviceId && name === exceptDeviceId + DOC_SUFFIX) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
      if (doc && doc._milestoneSync) out.push(doc);
    } catch { /* half-written: the writer will finish */ }
  }
  return out;
}

function writeDoc(doc) {
  if (!doc || typeof doc.deviceId !== 'string' || !/^[\w-]{1,64}$/.test(doc.deviceId)) {
    return { ok: false, error: 'A document with no usable device id.' };
  }
  const target = path.join(DATA, doc.deviceId + DOC_SUFFIX);
  const temp = path.join(DATA, '.' + doc.deviceId + '.tmp');
  fs.writeFileSync(temp, JSON.stringify(doc), 'utf8');
  fs.renameSync(temp, target);   // atomic, so a reader never sees half a document
  broadcast(doc.deviceId);
  return { ok: true, at: new Date().toISOString() };
}

// ── The push channel ──────────────────────────────────────────────────────────

/**
 * The same "tell me the moment it changes" the Wi-Fi bridge offers, at an
 * address that is always up — so two devices that are never on the same network
 * still update each other as soon as both are online, rather than on whatever
 * poll happens next.
 *
 * Server-sent events: plain HTTP on the connection already open, no dependency,
 * no upgrade handshake, and `EventSource` reconnects by itself — which is the
 * whole game on a phone that drops the socket every time you switch apps.
 *
 * The relay still learns nothing. It is told a document landed and passes that
 * on; what changed and whose version wins is decided on the devices, exactly as
 * before.
 */
const streams = new Set();
const HEARTBEAT_MS = 25_000;

function openStream(req, res, deviceId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    // A buffered stream is a stream that never arrives; proxies in front of a
    // hosted relay are exactly where that happens.
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write('event: hello\ndata: {}\n\n');

  const client = { res, deviceId };
  streams.add(client);

  const beat = setInterval(() => {
    try { res.write(': beat\n\n'); } catch { close(); }
  }, HEARTBEAT_MS);

  const close = () => {
    clearInterval(beat);
    streams.delete(client);
    try { res.end(); } catch { /* already gone */ }
  };
  req.on('close', close);
  req.on('error', close);
}

/** Everyone but the device that wrote it — pulling in response to your own
 *  edit is pure churn. */
function broadcast(fromDeviceId) {
  const payload = JSON.stringify({ from: fromDeviceId || null, at: new Date().toISOString() });
  for (const client of [...streams]) {
    if (fromDeviceId && client.deviceId === fromDeviceId) continue;
    try { client.res.write(`event: changed\ndata: ${payload}\n\n`); }
    catch { streams.delete(client); }
  }
}

function writeBackup(name, bundle) {
  const dir = path.join(DATA, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name || 'device.json').replace(/[^\w.-]/g, '_');
  fs.writeFileSync(path.join(dir, safe), JSON.stringify(bundle), 'utf8');
  return { ok: true };
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

/** A build artefact rather than a stray route — see the 404 below. */
const isAssetRequest = rel => /^assets\//.test(rel) || /\.(js|css|map|json|webmanifest)$/i.test(rel);

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) { res.writeHead(403).end('Not allowed.'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // A missing asset is a 404, not the shell: a phone asking for a chunk this
      // build no longer has must be told so. Handed HTML at status 200 instead,
      // the import rejects on the MIME type and the app unmounts to a blank
      // screen rather than reloading onto the current build.
      if (isAssetRequest(rel)) { res.writeHead(404, { 'Content-Type': TYPES['.txt'] }).end('Not found.'); return; }
      // Unknown path falls back to the shell; routing is hash-based.
      fs.readFile(path.join(DIST, 'index.html'), (shellErr, shell) => {
        if (shellErr) { res.writeHead(404).end('No build here. Copy dist/ next to this file.'); return; }
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }).end(shell);
      });
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Only the hashed build output is immutable — its name is its version.
    // index.html, sw.js, the web manifest and the icons keep one name across
    // every build, so pinning them for a year strands a phone on an old copy.
    const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  // The desktop reaches the relay from its own origin, so the browser asks first.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Milestone-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    }).end();
    return;
  }
  if (route.startsWith('/api/')) res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (!route.startsWith('/api/')) { serveStatic(res, route); return; }

    // Answered without the key so a device can tell this is a Milestone relay.
    // It says nothing about your data.
    if (route === '/api/health') { json(res, 200, { ok: true, app: 'milestone', relay: true }); return; }

    const sent = url.searchParams.get('t') || req.headers['x-milestone-token'];
    if (sent !== TOKEN) { json(res, 401, { ok: false, error: 'Wrong or missing key.' }); return; }

    if (route === '/api/events' && req.method === 'GET') {
      openStream(req, res, url.searchParams.get('deviceId') || '');
      return;
    }
    if (route === '/api/peers' && req.method === 'GET') {
      json(res, 200, { ok: true, peers: readDocs(url.searchParams.get('deviceId') || '') });
      return;
    }
    if (route === '/api/write' && req.method === 'POST') { json(res, 200, writeDoc(await readBody(req))); return; }
    if (route === '/api/backup' && req.method === 'POST') {
      const body = await readBody(req);
      json(res, 200, writeBackup(body && body.name, body && body.bundle));
      return;
    }
    json(res, 404, { ok: false, error: 'No such endpoint.' });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Milestone relay on :${PORT}`);
  console.log(`  documents  ${DATA}`);
  console.log(`  app        ${fs.existsSync(path.join(DIST, 'index.html')) ? DIST : DIST + '  (no build — API only)'}`);
});

export { server, readDocs, writeDoc };
