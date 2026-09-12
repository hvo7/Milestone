const { createAppWindow, registerIpcHandlers, readSharedRelay } = require('./desktop.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('relay provisioning requires an enabled private folder and valid HTTPS connection', t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'milestone-relay-config-test-'));
  const file = path.join(folder, 'milestone-relay-connection.json');
  t.after(() => { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(folder); });
  assert.equal(readSharedRelay({ enabled: true, folder }), undefined);
  fs.writeFileSync(file, JSON.stringify({ url: 'https://example.test/', token: 'test' }));
  assert.deepEqual(readSharedRelay({ enabled: true, folder }), { url: 'https://example.test', token: 'test' });
  assert.equal(readSharedRelay({ enabled: false, folder }), undefined);
  fs.writeFileSync(file, JSON.stringify({ url: 'http://example.test', token: 'test' }));
  assert.equal(readSharedRelay({ enabled: true, folder }), undefined);
});



function windowHarness(options = {}) {
  const calls = { devtools: 0, hidden: 0 };
  class Window extends EventEmitter {
    constructor(config) { super(); calls.config = config; this.webContents = {
      setWindowOpenHandler: handler => { calls.openExternal = handler; },
      openDevTools: () => { calls.devtools++; },
    }; }
    loadURL(url) { calls.url = url; }
    loadFile(file) { calls.file = file; }
    hide() { calls.hidden++; }
  }
  const win = createAppWindow({
    app: { isPackaged: false }, BrowserWindow: Window,
    shell: { openExternal: url => { calls.external = url; } },
    tray: { shouldHideOnClose: () => false }, ...options,
  });
  return { win, calls };
}

test('development launches the app without opening DevTools', () => {
  const { calls } = windowHarness();
  assert.equal(calls.devtools, 0);
  assert.equal(calls.url, 'http://localhost:5173');
  assert.equal(calls.config.webPreferences.contextIsolation, true);
  assert.equal(calls.config.webPreferences.nodeIntegration, false);
});

test('DevTools is available when explicitly requested', () => {
  assert.equal(windowHarness({ openDevTools: true }).calls.devtools, 1);
});

test('closing hides the window only when tray mode is enabled', () => {
  let prevented = false;
  const { win, calls } = windowHarness({ tray: { shouldHideOnClose: () => true } });
  win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(calls.hidden, 1);
  const normal = windowHarness();
  normal.win.emit('close', { preventDefault: () => assert.fail('ordinary close should quit') });
  assert.equal(normal.calls.hidden, 0);
});

test('links continue to open externally instead of spawning app windows', () => {
  const { calls } = windowHarness();
  assert.deepEqual(calls.openExternal({ url: 'https://example.com' }), { action: 'deny' });
  assert.equal(calls.external, 'https://example.com');
});

test('IPC deduplicates sync peers, preserves fallback, and resolves the current window', () => {
  const handlers = new Map();
  let currentWindow = { id: 1 };
  registerIpcHandlers({
    ipcMain: { handle: (name, fn) => { assert.equal(handlers.has(name), false); handlers.set(name, fn); } },
    shell: {}, notion: {}, updater: {}, backups: {}, tray: {},
    getWindow: () => currentWindow,
    cloudSync: {
      loadConfig: () => ({ deviceId: 'self' }),
      readPeers: () => ({ ok: true, peers: [{ deviceId: 'peer', updatedAt: '2026-01-01' }] }),
      writeDoc: () => ({ ok: false, error: 'Folder unavailable' }),
      pickFolder: win => win,
    },
    phone: {
      readDocs: () => [{ deviceId: 'peer', updatedAt: '2026-01-02' }],
      writeDoc: () => ({ ok: true }),
    },
  });
  assert.equal(handlers.get('sync:read-peers')().peers.length, 1);
  assert.equal(handlers.get('sync:read-peers')().peers[0].updatedAt, '2026-01-02');
  assert.deepEqual(handlers.get('sync:write')(null, {}), { ok: true });
  currentWindow = { id: 2 };
  assert.equal(handlers.get('sync:pick-folder')(), currentWindow);
});
