/**
 * The case the Wi-Fi bridge can't cover: the two devices are never awake at the
 * same time.
 *
 * So this deliberately never has both up together. The desktop publishes and
 * goes away; the phone loads the app *from the relay*, adopts that work, edits
 * while nothing else is running, and goes away; only then does the desktop come
 * back and read what the phone left. If any of it needed both ends live, this
 * fails.
 *
 * Throwaway data directories and synthetic content only.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const REPO = process.env.SMOKE_REPO;
const OUT = process.env.SMOKE_OUT;
const PORT = Number(process.env.SMOKE_PORT || 47861);
const TOKEN = 'smoke-key';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-relay-'));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-relay-profile-')));

let piped = true;
for (const s of [process.stdout, process.stderr]) s.on('error', () => { piped = false; });
const say = l => { if (piped) { try { process.stdout.write(l + '\n'); } catch { piped = false; } } };
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 170) : ''}`);
};

let relay = null;
const bail = code => {
  if (relay) { try { relay.kill(); } catch { /* already gone */ } }
  try { app.exit(code); } catch { process.exit(code); }
};
process.on('uncaughtException', e => {
  if (e && e.code === 'EPIPE') { piped = false; bail(3); return; }
  say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2);
});
setTimeout(() => { say('TIMEOUT'); bail(4); }, 4 * 60_000).unref?.();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function request(pathname, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: pathname, method, headers: body ? { 'Content-Type': 'application/json' } : {} },
      res => {
        let text = '';
        res.on('data', c => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** The quest slice as zustand persists it. */
const questSlice = titles => JSON.stringify({
  state: {
    questlines: [], systems: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    routines: titles.map((title, i) => ({
      id: 'r-' + i, title, description: '', recurring: 'daily', completed: false,
      trackedToday: true, lastResetAt: new Date().toISOString(), streak: 0,
    })),
  },
  version: 0,
});

const docsIn = () => fs.readdirSync(dataDir).filter(n => n.endsWith('.milestone-sync.json'));

app.whenReady().then(async () => {
  // ── The relay, running somewhere always-on ─────────────────────────────────
  relay = spawn(process.execPath, [path.join(REPO, 'server', 'relay.mjs')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MILESTONE_TOKEN: TOKEN,
      PORT: String(PORT),
      MILESTONE_DATA: dataDir,
      MILESTONE_DIST: path.join(REPO, 'dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let relayLog = '';
  relay.stdout.on('data', d => { relayLog += d; });
  relay.stderr.on('data', d => { relayLog += d; });
  await sleep(1200);

  const health = await request('/api/health');
  check('the relay is up', health.status === 200 && /"relay":true/.test(health.text), health.text.slice(0, 80) || relayLog.slice(0, 120));
  const noKey = await request('/api/peers');
  check('and will not hand over data without the key', noKey.status === 401, `status ${noKey.status}`);

  // ── The desktop publishes, then goes away ──────────────────────────────────
  const deskDoc = {
    _milestoneSync: 1,
    deviceId: 'desktop-test',
    deviceName: 'This computer',
    updatedAt: new Date().toISOString(),
    clock: { 'desktop-test': 1 },
    slotClocks: { quest: { 'desktop-test': 1 }, vynues: {}, ui: {} },
    stores: { quest: questSlice(['Left on the desktop']) },
  };
  const pushed = await request(`/api/write?t=${TOKEN}`, { method: 'POST', body: deskDoc });
  check('the desktop leaves its work there', /"ok":true/.test(pushed.text), pushed.text.slice(0, 80));
  // From here until the last section, nothing represents the desktop: it is off.

  // ── The phone, on its own ──────────────────────────────────────────────────
  const win = new BrowserWindow({
    width: 390, height: 844, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', e => {
    const msg = typeof e === 'object' && e.message ? e.message : '';
    const lvl = typeof e === 'object' && e.level !== undefined ? e.level : 0;
    if (lvl >= 3 && !msg.includes('Content-Security-Policy')) errors.push(msg);
  });
  const js = c => win.webContents.executeJavaScript(c, true);

  await win.loadURL(`http://127.0.0.1:${PORT}/?t=${TOKEN}`);
  await sleep(3500);

  const adopted = await js(`(() => {
    const raw = localStorage.getItem('milestone-v1');
    const state = raw ? JSON.parse(raw).state : null;
    return {
      titles: (state?.routines ?? []).map(r => r.title),
      rows: document.querySelectorAll('.task-row').length,
    };
  })()`);
  check('the phone gets the app and the work from the relay',
        adopted.titles.includes('Left on the desktop') && adopted.rows > 0,
        `${adopted.rows} rows: ${adopted.titles.join(', ')}`);

  // Edit with nothing else running — this is the whole point.
  const edited = await js(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /New task/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(700);
  const typed = await js(`(() => {
    const input = document.querySelector('.rune-input');
    if (!input) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'Added while away');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const add = [...document.querySelectorAll('button')].find(b => /^(Add|Create)/i.test(b.textContent.trim()));
    if (add) add.click();
    return !!add;
  })()`);
  await sleep(3200);

  const afterPhone = docsIn();
  const phoneDoc = (() => {
    for (const name of afterPhone) {
      const doc = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      if (doc.deviceId !== 'desktop-test') return doc;
    }
    return null;
  })();
  const phoneTitles = (() => {
    try { return JSON.parse(phoneDoc.stores.quest).state.routines.map(r => r.title); }
    catch { return []; }
  })();
  check('the edit made away is left on the relay', edited && typed && !!phoneDoc, afterPhone.join(', '));
  check('carrying what was typed', phoneTitles.includes('Added while away'), phoneTitles.join(', ') || 'none');
  check('and the desktop’s work with it', phoneTitles.includes('Left on the desktop'), phoneTitles.join(', ') || 'none');
  fs.writeFileSync(path.join(OUT, 'R-phone-away.png'), (await win.webContents.capturePage()).toPNG());

  // ── The phone keeps working with the relay unreachable ─────────────────────
  relay.kill();
  await sleep(900);
  const offline = await js(`(() => {
    const before = JSON.parse(localStorage.getItem('milestone-v1')).state.routines.length;
    const btn = [...document.querySelectorAll('button')].find(b => /New task/i.test(b.textContent || ''));
    btn.click();
    return before;
  })()`);
  await sleep(600);
  await js(`(() => {
    const input = document.querySelector('.rune-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'Added with no signal');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const add = [...document.querySelectorAll('button')].find(b => /^(Add|Create)/i.test(b.textContent.trim()));
    if (add) add.click();
    return true;
  })()`);
  await sleep(2500);
  const stillWorks = await js(`(() => {
    const state = JSON.parse(localStorage.getItem('milestone-v1')).state;
    return {
      titles: state.routines.map(r => r.title),
      rows: [...document.querySelectorAll('.task-row')].map(r => r.innerText.replace(/\\n/g, ' ')),
    };
  })()`);
  check('the phone still saves with the relay down',
        stillWorks.titles.includes('Added with no signal'), `${offline} → ${stillWorks.titles.length}`);
  check('and still shows it', stillWorks.rows.some(t => /Added with no signal/.test(t)), stillWorks.rows.length + ' rows');

  // ── The desktop comes back, alone ──────────────────────────────────────────
  relay = spawn(process.execPath, [path.join(REPO, 'server', 'relay.mjs')], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MILESTONE_TOKEN: TOKEN,
      PORT: String(PORT),
      MILESTONE_DATA: dataDir,
      MILESTONE_DIST: path.join(REPO, 'dist'),
    },
    stdio: 'ignore',
  });
  await sleep(1400);
  // The phone is asked to publish again now the relay is back — the same retry a
  // real one makes on its poll.
  await js(`window.dispatchEvent(new Event('focus')); true`);
  await sleep(2500);

  const seenByDesktop = await request(`/api/peers?t=${TOKEN}&deviceId=desktop-test`);
  const peers = JSON.parse(seenByDesktop.text).peers || [];
  const fromPhone = peers.find(p => p.deviceId !== 'desktop-test');
  const finalTitles = (() => {
    try { return JSON.parse(fromPhone.stores.quest).state.routines.map(r => r.title); }
    catch { return []; }
  })();
  check('the desktop finds the phone’s work waiting', !!fromPhone, peers.map(p => p.deviceName).join(', ') || 'none');
  check('including the edit made with no signal', finalTitles.includes('Added with no signal'), finalTitles.join(', ') || 'none');

  say('\nCONSOLE ERRORS: ' + (errors.length ? JSON.stringify(errors.slice(0, 4)) : 'none'));
  const failed = results.filter(r => !r.pass);
  say(`\n${results.length - failed.length}/${results.length} checks passed`);
  bail(failed.length || errors.length ? 1 : 0);
}).catch(e => { say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2); });
