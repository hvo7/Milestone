// Standalone entry point: never imports production main, IPC handlers, or services.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const testingDir = path.join(root, '.testing');
app.setName('Milestone Testing');
for (const [key, folder] of [['userData', 'profile'], ['sessionData', 'session'], ['logs', 'logs']]) {
  const dir = path.join(testingDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath(key, dir);
}
if (process.platform === 'win32') app.setAppUserModelId('Milestone.Testing');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let win;
  app.on('second-instance', () => { if (win) { win.restore(); win.show(); win.focus(); } });
  ipcMain.on('testing:seed', event => {
    try {
      const source = JSON.parse(fs.readFileSync(path.join(testingDir, 'seed.json'), 'utf8'));
      event.returnValue = { quest: source.quest, vynues: source.vynues, exportedAt: source.exportedAt };
    } catch { event.returnValue = {}; }
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, done) => done({ cancel: true }));
    win = new BrowserWindow({
      title: 'Milestone — TESTING · Batch 003', width: 1440, height: 940,
      backgroundColor: '#191e25', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'testing-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.on('page-title-updated', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (win.isDestroyed()) return;
        const report = await win.webContents.executeJavaScript(`JSON.stringify({title:document.title, testing:!!document.querySelector('[data-testing-banner]'), artwork:document.querySelectorAll('[data-quest-artwork]').length, productionBridge:!!window.electronAPI, text:document.body.innerText.slice(0,500)})`);
        fs.writeFileSync(path.join(testingDir, 'smoke-check.json'), report);
        const picture = await win.webContents.capturePage();
        fs.writeFileSync(path.join(testingDir, 'preview.png'), picture.toPNG());
      }, 1800);
    });
    win.loadFile(path.join(root, 'dist-testing/index.html'), { hash: '/' });
  });
  app.on('window-all-closed', () => app.quit());
}
