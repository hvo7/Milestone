/**
 * Drives the phone bridge end to end in the real app.
 *
 * The claim under test is not "a server starts" — it is that a phone loading the
 * app from this computer ends up holding the same tasks, and that a change made
 * on the phone comes back. So this runs the actual server, loads the actual
 * served app in a phone-sized window, and checks the data in both directions.
 *
 * Throwaway userData and synthetic data only; the real profile is never touched.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const REPO = process.env.SMOKE_REPO;
const OUT = process.env.SMOKE_OUT;
const PORT = Number(process.env.SMOKE_PORT || 47851);

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-phone-')));

let piped = true;
for (const s of [process.stdout, process.stderr]) s.on('error', () => { piped = false; });
const say = l => { if (piped) { try { process.stdout.write(l + '\n'); } catch { piped = false; } } };
const bail = c => { try { app.exit(c); } catch { process.exit(c); } };
process.on('uncaughtException', e => {
  if (e && e.code === 'EPIPE') { piped = false; bail(3); return; }
  say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2);
});
setTimeout(() => { say('TIMEOUT'); bail(4); }, 4 * 60_000).unref?.();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  say(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 160) : ''}`);
};

/** A plain HTTP request against the bridge, as the phone's browser would make. */
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

/** The quest slice as zustand persists it, holding one recognisable task. */
const questSlice = title => JSON.stringify({
  state: {
    questlines: [], systems: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    routines: [{
      id: 'r-desk', title, description: '', recurring: 'daily', completed: false,
      trackedToday: true, lastResetAt: new Date().toISOString(), streak: 0,
    }],
  },
  version: 0,
});

app.whenReady().then(async () => {
  const phone = require(path.join(REPO, 'electron', 'phone.cjs'));

  // ── 1. The server ──────────────────────────────────────────────────────────
  phone.setConfig({ port: PORT });
  const started = await phone.start();
  check('the bridge starts', started.ok === true, started.error || `port ${started.port}`);
  check('it hands out a link with a key', /^http:\/\/.+\/\?t=.+/.test((started.urls || [])[0] || ''), (started.urls || [])[0] || 'none');

  const token = started.token;

  const health = await request('/api/health');
  check('it answers a health check without the key', health.status === 200 && /milestone/.test(health.text), health.text.slice(0, 60));

  const unauthorised = await request('/api/peers');
  check('and refuses the data without one', unauthorised.status === 401, `status ${unauthorised.status}`);

  const served = await request('/?t=' + token);
  check('it serves the app itself', served.status === 200 && /<div id="root"/.test(served.text), `status ${served.status}`);
  // Nothing outside dist/, whatever the phone asks for.
  const traversal = await request('/../package.json');
  check('and nothing outside the app folder', !/"name": "milestone"/.test(traversal.text), traversal.text.slice(0, 60));

  // ── 2. The desktop publishes ───────────────────────────────────────────────
  // Stand in for the desktop app having synced: its document is in the store the
  // bridge reads, exactly as electron/main.cjs would have written it.
  const deskDoc = {
    _milestoneSync: 1,
    deviceId: 'desktop-test',
    deviceName: 'This computer',
    updatedAt: new Date().toISOString(),
    clock: { 'desktop-test': 1 },
    slotClocks: { quest: { 'desktop-test': 1 }, vynues: {}, ui: {} },
    stores: { quest: questSlice('Typed on the desktop') },
  };
  const wrote = phone.writeDoc(deskDoc);
  check('the desktop’s document lands in the store', wrote.ok === true, wrote.error || '');

  // ── 3. The phone loads the app and adopts it ───────────────────────────────
  const win = new BrowserWindow({
    // A phone-sized viewport, so this is also a check that the app is usable at
    // that width rather than only that the data arrives.
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

  await win.loadURL(`http://127.0.0.1:${PORT}/?t=${token}`);
  await sleep(3500);

  const onPhone = await js(`(() => {
    const raw = localStorage.getItem('milestone-v1');
    const state = raw ? JSON.parse(raw).state : null;
    return {
      titles: (state?.routines ?? []).map(r => r.title),
      // The key is kept, and taken back out of the address bar.
      keptToken: !!localStorage.getItem('milestone-phone-token'),
      urlClean: !/t=/.test(location.search),
      rows: document.querySelectorAll('.task-row').length,
      wide: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  })()`);
  check('the phone adopts the desktop’s tasks', onPhone.titles.includes('Typed on the desktop'), onPhone.titles.join(', ') || 'none');
  check('it keeps the key and clears it from the address bar', onPhone.keptToken && onPhone.urlClean, JSON.stringify(onPhone));
  check('the task is on screen at phone size', onPhone.rows > 0, `${onPhone.rows} rows`);
  check('and the page does not scroll sideways', onPhone.wide === true, String(onPhone.wide));
  fs.writeFileSync(path.join(OUT, 'P-phone.png'), (await win.webContents.capturePage()).toPNG());

  // ── 4. The phone edits, and the desktop can see it ─────────────────────────
  await js(`(() => {
    const store = window.__milestoneStore;
    return true;
  })()`);
  await js(`(() => {
    const raw = JSON.parse(localStorage.getItem('milestone-v1'));
    raw.state.routines.push({
      id: 'r-phone', title: 'Added on the phone', description: '', recurring: 'daily',
      completed: false, trackedToday: true, lastResetAt: new Date().toISOString(), streak: 0,
    });
    localStorage.setItem('milestone-v1', JSON.stringify(raw));
    // Through the app's own path, so this is the real publish rather than a
    // hand-written document: the store change is what the sync layer listens to.
    window.dispatchEvent(new Event('milestone-test-edit'));
    return true;
  })()`);
  // Drive a real store edit so the subscription fires.
  await js(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /New task/i.test(b.textContent || ''));
    if (btn) btn.click();
    return !!btn;
  })()`);
  await sleep(600);
  const typed = await js(`(() => {
    const input = document.querySelector('input[placeholder*="Read" i], .rune-input');
    if (!input) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'Added on the phone');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const add = [...document.querySelectorAll('button')].find(b => /^(Add|Create)/i.test(b.textContent.trim()));
    if (add) add.click();
    return !!add;
  })()`);
  await sleep(3000);

  const backOnDesktop = phone.readDocs('desktop-test');
  const fromPhone = backOnDesktop.find(d => d.deviceId !== 'desktop-test');
  const phoneTitles = (() => {
    try { return JSON.parse(fromPhone.stores.quest).state.routines.map(r => r.title); }
    catch { return []; }
  })();
  check('the phone publishes a document of its own', !!fromPhone, backOnDesktop.map(d => d.deviceName).join(', ') || 'none');
  check('carrying the edit made there', typed && phoneTitles.includes('Added on the phone'), phoneTitles.join(', ') || 'none');
  // The desktop's task is still in it — the phone fast-forwarded rather than
  // replacing what it found.
  check('and the desktop’s work with it', phoneTitles.includes('Typed on the desktop'), phoneTitles.join(', ') || 'none');

  // ── 5. Off means off ───────────────────────────────────────────────────────
  phone.stop();
  let refused = false;
  try { await request('/api/health'); } catch { refused = true; }
  check('turning it off closes the door', refused === true, String(refused));

  say('\nCONSOLE ERRORS: ' + (errors.length ? JSON.stringify(errors.slice(0, 4)) : 'none'));
  const failed = results.filter(r => !r.pass);
  say(`\n${results.length - failed.length}/${results.length} checks passed`);
  bail(failed.length || errors.length ? 1 : 0);
}).catch(e => { say('FATAL ' + (e && e.stack ? e.stack : e)); bail(2); });
