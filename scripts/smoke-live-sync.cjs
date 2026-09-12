// Three isolated clients, the production renderer and the real relay protocol.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestone-live-test-'));
const output = process.env.MILESTONE_TEST_OUTPUT || temp;
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
const port = 34000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const relay = spawn('node', [path.join(root, 'server', 'relay.mjs')], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, PORT: String(port), MILESTONE_TOKEN: 'synthetic-test', MILESTONE_DATA: path.join(temp, 'docs') },
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label) => {
  for (let n = 0; n < 100; n++) { if (await fn()) return; await pause(100); }
  throw new Error(`Timed out: ${label}`);
};
const timeout = setTimeout(() => { relay.kill(); app.exit(2); }, 60000);
app.whenReady().then(async () => {
  await until(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 'relay');
  const now = new Date().toISOString();
  const fixture = { questlines: [], systems: [], routines: [{ id: 'mile', title: 'Live sync test mile', recurring: 'daily', completed: false, trackedToday: true, anchor: true, lastResetAt: now }], completionLog: {}, taskHistory: {}, todoOrder: {}, anchorSystemRetired: true };
  await fetch(base + '/api/write?t=synthetic-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _milestoneSync: 1, deviceId: 'seed', deviceName: 'Seed', updatedAt: now, clock: { seed: 1 }, stores: { quest: JSON.stringify({ state: fixture, version: 0 }) } }) });
  const clients = [];
  for (const name of ['phone', 'desktop', 'laptop']) {
    const win = new BrowserWindow({ show: false, width: name === 'phone' ? 390 : 1280, webPreferences: { partition: name, backgroundThrottling: false } });
    await win.loadURL(base + '/?t=synthetic-test');
    clients.push(win);
    await until(() => win.webContents.executeJavaScript(`!!document.querySelector('input[aria-label="Live sync test mile"]')`), name);
  }
  const checkAll = async completed => (await Promise.all(clients.map(win => win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('milestone-v1')).state.routines.find(r => r.id === 'mile')?.completed === ${completed} && document.querySelector('input[aria-label="Live sync test mile"]')?.checked === ${completed}`)))).every(Boolean);
  const start = Date.now();
  await clients[0].webContents.executeJavaScript(`document.querySelector('input[aria-label="Live sync test mile"]').click()`);
  await until(() => checkAll(true), 'phone completion reaches desktop and laptop');
  const phoneToAllMs = Date.now() - start;
  assert(phoneToAllMs < 4000, 'Push should arrive before the fallback poll');
  const undoStart = Date.now();
  await clients[1].webContents.executeJavaScript(`document.querySelector('input[aria-label="Live sync test mile"]').click()`);
  await until(() => checkAll(false), 'desktop undo reaches phone and laptop');
  const desktopToAllMs = Date.now() - undoStart;
  assert(desktopToAllMs < 4000);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'live-sync-result.json'), JSON.stringify({ passed: true, clients: 3, phoneToAllMs, desktopToAllMs, pageReloadsAfterEdits: 0 }, null, 2));
  clearTimeout(timeout); relay.kill(); app.quit();
}).catch(err => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'live-sync-error.txt'), String(err));
  clearTimeout(timeout); relay.kill(); app.exit(1);
});
