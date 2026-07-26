const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, testConnection, syncToNotion, pullFromNotion } = require('./notion.cjs');

// ── Identity ─────────────────────────────────────────────────────────────────
// Electron derives userData from the app name, and npm names must be lowercase —
// so set the display name explicitly to keep the profile at %APPDATA%\Milestone
// rather than %APPDATA%\milestone. This must run before anything reads userData.
app.setName('Milestone');

/** The pre-rename profile, back when the npm name was still 'rpg-quest-tracker'. */
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'rpg-quest-tracker');

/**
 * One-time move of the old profile into the Milestone one, on first launch after
 * the rename. Every quest, streak and Vynues project lives in Local Storage, and
 * the Notion API key in notion-config.json — without this the app would come up
 * to an empty profile with Notion disconnected.
 *
 * Copies (never moves), so the old folder stays put as a fallback. Only real data
 * is taken: caches are disposable, and leveldb's LOCK is held by whichever process
 * has the profile open — copying it is both pointless and a way to fail. Runs
 * before `whenReady`, so Chromium hasn't opened Local Storage yet.
 */
function migrateLegacyProfile() {
  const target = app.getPath('userData');
  // Local Storage is the marker: a profile that already has it needs nothing.
  if (fs.existsSync(path.join(target, 'Local Storage'))) return;
  if (!fs.existsSync(LEGACY_USER_DATA)) return;

  try {
    fs.mkdirSync(target, { recursive: true });
    const localStorage = path.join(LEGACY_USER_DATA, 'Local Storage');
    if (fs.existsSync(localStorage)) {
      fs.cpSync(localStorage, path.join(target, 'Local Storage'), {
        recursive: true,
        filter: src => path.basename(src) !== 'LOCK',
      });
    }
    for (const file of ['notion-config.json', 'notion-id-map.json']) {
      const from = path.join(LEGACY_USER_DATA, file);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
    }
    console.log(`[migrate] copied profile ${LEGACY_USER_DATA} -> ${target}`);
  } catch (e) {
    // A failed migration must not be a failed launch: the old profile is untouched,
    // so the user can recover by rolling back rather than losing the app entirely.
    console.error('[migrate] could not copy the old profile:', e.message);
  }
}

migrateLegacyProfile();

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../build/icon.ico');

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath,
    title: 'Milestone',
    backgroundColor: '#0e1014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  }
}

// ── Notion IPC handlers ───────────────────────────────────────────────────────

ipcMain.handle('notion:load-config', () => loadConfig());

ipcMain.handle('notion:save-config', (_event, config) => {
  saveConfig(config);
});

ipcMain.handle('notion:test-connection', (_event, apiKey) => testConnection(apiKey));

ipcMain.handle('notion:pull', async () => {
  const config = loadConfig();
  if (!config?.apiKey) return { ok: false, error: 'No config saved. Run a Push sync first.' };
  try { return await pullFromNotion(config); }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('notion:sync', async (_event, { questlines, routines }) => {
  const config = loadConfig();
  if (!config?.apiKey || !config?.parentPageId) {
    return { ok: false, error: 'No Notion config saved. Open the sync panel and save your API key first.' };
  }
  try {
    return await syncToNotion(questlines, routines, config);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
