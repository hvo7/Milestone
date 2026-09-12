const { migrateLegacyProfile, createAppWindow, registerIpcHandlers } = require('./desktop.cjs');
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const notion = require('./notion.cjs');



const cloudSync = require('./cloudSync.cjs');
const backups = require('./backups.cjs');
const tray = require('./tray.cjs');
const phone = require('./phone.cjs');
const updater = require('./updater.cjs');

// ── Identity ─────────────────────────────────────────────────────────────────
// Electron derives userData from the app name, and npm names must be lowercase —
// so set the display name explicitly to keep the profile at %APPDATA%\Milestone
// rather than %APPDATA%\milestone. This must run before anything reads userData.
app.setName('Milestone');
// Windows attributes a toast to an AppUserModelID, not to the process. Without
// this the reminder arrives labelled "electron.app.Milestone" — or, on some
// setups, doesn't arrive at all.
if (process.platform === 'win32') app.setAppUserModelId('Milestone');

migrateLegacyProfile(path.join(app.getPath('appData'), 'rpg-quest-tracker'), app.getPath('userData'));



/** The live window, so the folder watcher has somewhere to push change notices. */
let mainWindow = null;

function createWindow() {
  const win = createAppWindow({ app, BrowserWindow, shell, tray, openDevTools: process.argv.includes('--devtools') });
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
}

/** Bring the window back — from the tray icon, its menu, or a notification click. */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

registerIpcHandlers({ ipcMain, shell, notion, cloudSync, phone, updater, backups, tray, getWindow: () => mainWindow });

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  tray.init(showMainWindow);
  createWindow();
  // A document arriving from the phone wakes the renderer exactly like one
  // landing in the sync folder — same channel, same reconciliation.
  phone.onChange(fromDeviceId => {
    // Except our own. `sync:write` publishes through this same store, so every
    // edit made here was waking this window to reconcile against a document it
    // had just written itself — a full pull per edit, for nothing.
    if (fromDeviceId && fromDeviceId === cloudSync.loadConfig().deviceId) return;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:changed');
  });
  if (phone.loadConfig().enabled) void phone.start();
  cloudSync.initWatcher(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:changed');
  });
  // Progress goes to the window as it happens rather than being polled: a
  // download that takes a minute should look like one.
  updater.onChange(status => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
  });
  updater.start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Menu "Quit", ⌘Q and a system shutdown all arrive here first — after this the
// close handler must let the window actually close.
app.on('before-quit', () => {
  tray.markQuitting();
  // A build downloaded earlier gets installed on the way out, so the next launch
  // is already the new version and nobody had to be asked. Explicitly without a
  // relaunch: this is a quit, and it should stay one.
  if (updater.hasStaged()) updater.applyStaged({ relaunch: false });
});

app.on('window-all-closed', () => {
  // With the tray holding the app open there are no windows by design; quitting
  // here would defeat the setting that was just switched on.
  if (tray.shouldHideOnClose()) return;
  if (process.platform !== 'darwin') app.quit();
});
