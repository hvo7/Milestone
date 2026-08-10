const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, testConnection, syncToNotion, pullFromNotion } = require('./notion.cjs');
const cloudSync = require('./cloudSync.cjs');
const backups = require('./backups.cjs');

// ── Identity ─────────────────────────────────────────────────────────────────
// Electron derives userData from the app name, and npm names must be lowercase —
// so set the display name explicitly to keep the profile at %APPDATA%\Milestone
// rather than %APPDATA%\milestone. This must run before anything reads userData.
app.setName('Milestone');

/** The pre-rename profile, back when the npm name was still 'rpg-quest-tracker'. */
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'rpg-quest-tracker');

/**
 * Does a profile's Local Storage actually hold Milestone data?
 *
 * The presence of the *folder* says nothing: Chromium creates it on first launch
 * whether or not anything was ever written, so "folder exists" is true for a
 * profile that has never held a single quest. Treating that as "already migrated"
 * is what let a reset profile permanently refuse to bring the old data forward.
 *
 * So look for the store key itself. LevelDB is an opaque format, but the key is
 * written literally into the log/table files, and finding it is enough to answer
 * the only question here — is there anything to lose? A false positive costs a
 * skipped migration, so the check errs the other way and reports "no data" when
 * it cannot read the profile at all.
 */
function profileHasQuestData(profileDir) {
  const leveldb = path.join(profileDir, 'Local Storage', 'leveldb');
  let files;
  try {
    files = fs.readdirSync(leveldb).filter(f => f.endsWith('.log') || f.endsWith('.ldb'));
  } catch {
    return false; // no leveldb at all
  }
  // Both the current key and the pre-rename one: either means real data is here.
  const markers = ['milestone-v1', 'rpg-quest-tracker-v1'];
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(leveldb, file), 'latin1');
      if (markers.some(m => text.includes(m))) return true;
    } catch { /* unreadable file — keep looking */ }
  }
  return false;
}

/**
 * One-time copy of the old profile into the Milestone one, on first launch after
 * the rename. Every quest, streak and Vynues project lives in Local Storage, and
 * the Notion API key in notion-config.json — without this the app would come up
 * to an empty profile with Notion disconnected.
 *
 * Copies (never moves), so the old folder stays put as a fallback. Only real data
 * is taken: caches are disposable, and leveldb's LOCK is held by whichever process
 * has the profile open — copying it is both pointless and a way to fail. Runs
 * before `whenReady`, so Chromium hasn't opened Local Storage yet.
 *
 * Never overwrites: if this profile already holds data, the legacy copy is left
 * where it is and `scripts/recover-profile.mjs` can extract it on demand.
 */
function migrateLegacyProfile() {
  const target = app.getPath('userData');
  if (!fs.existsSync(LEGACY_USER_DATA)) return;
  if (!profileHasQuestData(LEGACY_USER_DATA)) return;   // nothing worth taking
  if (profileHasQuestData(target)) return;              // would clobber real data

  try {
    fs.mkdirSync(target, { recursive: true });
    const localStorage = path.join(LEGACY_USER_DATA, 'Local Storage');
    if (fs.existsSync(localStorage)) {
      // The target's Local Storage may exist but be empty (see above), in which
      // case there is nothing of value to preserve and force is safe.
      fs.cpSync(localStorage, path.join(target, 'Local Storage'), {
        recursive: true,
        force: true,
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

/** The live window, so the folder watcher has somewhere to push change notices. */
let mainWindow = null;

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

  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
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

// ── Cloud-folder sync IPC ─────────────────────────────────────────────────────
// Folder access only — which side's data wins is decided in src/lib/cloudSync.ts.

ipcMain.handle('sync:get-config', () => cloudSync.loadConfig());
ipcMain.handle('sync:set-config', (_event, patch) => cloudSync.setConfig(patch));
ipcMain.handle('sync:pick-folder', () => cloudSync.pickFolder(mainWindow));
ipcMain.handle('sync:read-peers', () => cloudSync.readPeers());
ipcMain.handle('sync:write', (_event, doc) => cloudSync.writeDoc(doc));
ipcMain.handle('sync:write-backup', (_event, { name, bundle }) => cloudSync.writeBackup(name, bundle));

// ── Automatic local backups ───────────────────────────────────────────────────
// The safety net under the single Local Storage database — see electron/backups.cjs.

ipcMain.handle('backup:save', (_event, bundle) => backups.save(bundle));
ipcMain.handle('backup:list', () => backups.list());
ipcMain.handle('backup:read', (_event, name) => backups.read(name));
ipcMain.handle('backup:reveal', () => shell.openPath(backups.folder()));

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  cloudSync.initWatcher(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sync:changed');
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
