/**
 * Cross-computer sync over a folder the OS already syncs for you — OneDrive,
 * Dropbox, Google Drive. No account, no server, no network code: Milestone
 * writes its data as a small JSON file into that folder, the cloud client
 * carries the file to the other machine, and a watcher here notices it land.
 *
 * The one rule that keeps this from turning into a mess of conflict copies:
 * **a device only ever writes its own file**, named after its device id. Two
 * machines therefore never write the same path, so OneDrive is never asked to
 * merge anything and never produces a "Milestone-DESKTOP (1).json". Each device
 * reads its peers' files and reconciles in the renderer (see src/lib/cloudSync.ts).
 *
 * This module is deliberately dumb — config, folder I/O and a watcher. Every
 * decision about *whose* data wins lives on the renderer side, next to the
 * stores it has to apply the answer to.
 */
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/** Suffix that marks a device document. The device id is the stem, which is how
 *  a device recognises (and skips) its own file when reading the folder. */
const DOC_SUFFIX = '.milestone-sync.json';

const configPath = () => path.join(app.getPath('userData'), 'sync-config.json');

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Config, with this device's identity minted on first read. That identity is
 * permanent: it names this device's file in the shared folder and keys its entry
 * in every vector clock, so regenerating it would orphan the old file and make
 * this machine look like a brand-new device with no history.
 */
function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch { saved = {}; }

  let minted = false;
  if (!saved.deviceId)   { saved.deviceId = crypto.randomUUID(); minted = true; }
  if (!saved.deviceName) { saved.deviceName = os.hostname() || 'This computer'; minted = true; }
  if (minted) { try { writeConfig(saved); } catch { /* first run on a read-only profile — carry on in memory */ } }

  return { enabled: false, folder: '', ...saved };
}

function setConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  writeConfig(next);
  restartWatcher(next);
  return next;
}

async function pickFolder(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a folder your cloud drive syncs',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use this folder',
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
}

const docPath = (config) => path.join(config.folder, config.deviceId + DOC_SUFFIX);

/** Every device document in the folder except this one's. Malformed files are
 *  skipped rather than fatal: a half-written file from a cloud client mid-copy
 *  is a normal, transient thing to find, and the next watcher tick re-reads it. */
function readPeers() {
  const config = loadConfig();
  if (!config.folder) return { ok: false, error: 'No sync folder chosen yet.' };
  let entries;
  try {
    entries = fs.readdirSync(config.folder);
  } catch (e) {
    // The usual cause is the folder being renamed, unshared, or not yet created
    // by the cloud client on a fresh machine.
    return { ok: false, error: `Can't read the sync folder — ${e.code === 'ENOENT' ? 'it no longer exists' : e.message}.` };
  }

  const peers = [];
  let unreadable = 0;
  for (const name of entries) {
    if (!name.endsWith(DOC_SUFFIX)) continue;
    if (name === config.deviceId + DOC_SUFFIX) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(config.folder, name), 'utf8'));
      if (doc && doc._milestoneSync) peers.push(doc);
    } catch {
      unreadable++;
    }
  }
  return { ok: true, peers, unreadable };
}

/** Writes this device's document. Written to a temp name and renamed into place
 *  so a peer (or a cloud client) can never pick up a half-written file — rename
 *  is atomic on NTFS and replaces the old file in one step. */
function writeDoc(doc) {
  const config = loadConfig();
  if (!config.folder) return { ok: false, error: 'No sync folder chosen yet.' };
  const target = docPath(config);
  const temp = path.join(config.folder, `.${config.deviceId}.tmp`);
  try {
    fs.mkdirSync(config.folder, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(doc), 'utf8');
    fs.renameSync(temp, target);
    return { ok: true, at: new Date().toISOString() };
  } catch (e) {
    try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
    return { ok: false, error: e.message };
  }
}

/** Drops a rescue copy into the folder's `backups/` — used when two machines
 *  edited independently and one side's version is about to be replaced. The file
 *  is written in the Backup & Restore bundle format on purpose, so recovering it
 *  is just "Load backup" in the Data panel rather than a support conversation. */
function writeBackup(name, bundle) {
  const config = loadConfig();
  if (!config.folder) return { ok: false, error: 'No sync folder chosen yet.' };
  try {
    const dir = path.join(config.folder, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(bundle), 'utf8');
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Folder watcher ────────────────────────────────────────────────────────────
// What makes an edit on one machine show up on the other without a refresh.

let watcher = null;
let watchTimer = null;
let notify = () => {};

function restartWatcher(config = loadConfig()) {
  if (watcher) { try { watcher.close(); } catch { /* already gone */ } watcher = null; }
  if (!config.enabled || !config.folder) return;
  try {
    watcher = fs.watch(config.folder, () => {
      // A cloud client can touch a file several times as it lands (create,
      // write, rename, attribute change). Coalesce, or every arrival would kick
      // off its own read-and-reconcile pass.
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => notify(), 600);
    });
    // A folder that goes away (unmounted, renamed) shouldn't take the app with it.
    watcher.on('error', () => { try { watcher.close(); } catch { /* already gone */ } watcher = null; });
  } catch {
    watcher = null; // the renderer still polls on its own schedule
  }
}

/** Called once at startup with the callback that tells the renderer to re-read. */
function initWatcher(onChanged) {
  notify = onChanged;
  restartWatcher();
}

module.exports = { loadConfig, setConfig, pickFolder, readPeers, writeDoc, writeBackup, initWatcher };
