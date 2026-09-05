/**
 * The desktop app keeping itself current.
 *
 * Until now every computer running Milestone was updated by hand — pull, build,
 * package, run install.ps1 — which meant in practice that whichever machine you
 * were not sitting at was months behind. The phone had a story (the PWA
 * redeploys itself); the desktop had none.
 *
 * What this does: asks GitHub what the newest release is, downloads it in the
 * background if it is newer than the running app, unpacks it beside the profile,
 * and swaps it into place *after this process exits* — because Windows will not
 * let a running executable be overwritten, and nothing else about the update is
 * hard.
 *
 * ── Why hand-rolled ─────────────────────────────────────────────────────────
 * electron-updater is the obvious answer and it wants electron-builder, an NSIS
 * installer and a code-signing certificate to be at its best. This app is
 * packaged with @electron/packager into a folder that install.ps1 copies to
 * %LOCALAPPDATA%\Milestone, and that arrangement works. Replacing the whole
 * packaging and installation story to gain an update mechanism is a much larger
 * change than the one actually being asked for, so this is the small version of
 * it: three HTTPS requests, an Expand-Archive, and a copy on the way out. The
 * same reasoning that left sw.js and relay.mjs dependency-free.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 * Nothing here touches %APPDATA%\Milestone, where the data lives. An update
 * replaces the program and never the profile — so a failed update costs a
 * launch, not a questline. And the swap copies *over* the install rather than
 * deleting it first: a copy that dies halfway leaves a working mixture of two
 * builds, where a delete that dies halfway leaves nothing to start.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
// Its own module so it can be tested without pulling Electron into the test run
// — it is the one decision here that fails silently when it is wrong.
const { isNewer } = require('./semver.cjs');
// The other one. Every path this file hands to PowerShell goes through here.
const { psLiteral } = require('./psQuote.cjs');

/** Where releases are published. Read from package.json so a fork does not have
 *  to remember this file exists. */
function repoSlug() {
  try {
    const pkg = require('../package.json');
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url;
    const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url || '');
    if (match) return match[1];
  } catch { /* fall through to the default below */ }
  return 'hvo7/Milestone';
}

const RELEASE_API = () => `https://api.github.com/repos/${repoSlug()}/releases/latest`;

/** First check is delayed: launch is the busiest moment the app has, and an
 *  update that arrives ninety seconds later is no less useful. */
const FIRST_CHECK_MS = 90_000;
/** A machine left running for days should still find a release the same day. */
const CHECK_EVERY_MS = 6 * 60 * 60_000;

const updatesDir = () => path.join(app.getPath('userData'), 'updates');
const statePath = () => path.join(updatesDir(), 'state.json');
const logPath = () => path.join(updatesDir(), 'update.log');

/** Kept deliberately small and readable: when an update does go wrong, this file
 *  is the only witness, since by then the app has been replaced. */
function log(message) {
  try {
    fs.mkdirSync(updatesDir(), { recursive: true });
    fs.appendFileSync(logPath(), `${new Date().toISOString()}  ${message}\n`);
  } catch { /* logging must never be the thing that breaks an update */ }
}

// ── State ─────────────────────────────────────────────────────────────────────

/**
 * What the renderer is told, and what survives a restart.
 *
 * `staged` is the whole point of persisting any of this: a build downloaded
 * yesterday and not yet applied should be applied on the next quit, not
 * downloaded again.
 */
let state = {
  /** 'idle' | 'checking' | 'downloading' | 'staged' | 'error' */
  phase: 'idle',
  currentVersion: app.getVersion(),
  /** Version available on GitHub, once we've looked. */
  latestVersion: null,
  /** Directory holding an unpacked build that is ready to swap in. */
  staged: null,
  stagedVersion: null,
  checkedAt: null,
  error: null,
  /** False in development and in an unpackaged tree, where there is nothing to
   *  replace — the card says so rather than offering a button that cannot work. */
  supported: app.isPackaged && process.platform === 'win32',
};

let notify = () => {};
/** Called by main.cjs with a function that pushes state at the renderer. */
function onChange(fn) { notify = fn; }

function setState(patch) {
  state = { ...state, ...patch };
  try { notify(status()); } catch { /* the window may be gone */ }
}

function status() { return { ...state }; }

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    // Only trust a staged build that is still on disk and still newer than what
    // is running — an update applied by hand in the meantime makes it garbage.
    if (saved.staged && fs.existsSync(path.join(saved.staged, 'Milestone.exe')) && isNewer(saved.stagedVersion, app.getVersion())) {
      setState({ phase: 'staged', staged: saved.staged, stagedVersion: saved.stagedVersion, latestVersion: saved.stagedVersion });
      log(`found a staged ${saved.stagedVersion} from a previous session`);
    } else if (saved.staged) {
      discardStaged(saved.staged);
    }
  } catch { /* no state yet, which is the normal first run */ }
}

function saveState() {
  try {
    fs.mkdirSync(updatesDir(), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify({ staged: state.staged, stagedVersion: state.stagedVersion }, null, 2));
  } catch (err) { log(`could not save state: ${err.message}`); }
}

function discardStaged(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* it will be overwritten anyway */ }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

/**
 * GitHub's API, as JSON.
 *
 * A User-Agent is not optional — the API rejects requests without one — and the
 * redirect to the CDN that asset downloads take has to be followed by hand,
 * since node:https does not.
 */
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Milestone-Updater', 'Accept': 'application/vnd.github+json' },
      timeout: 20_000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        resolve(getJson(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GitHub answered ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('Timed out reaching GitHub.')); });
  });
}

/** Download to a file, following the CDN redirect release assets always take. */
function download(url, target, onProgress) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'Milestone-Updater', 'Accept': 'application/octet-stream' },
      timeout: 60_000,
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        resolve(download(res.headers.location, target, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download answered ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let seen = 0;
      const file = fs.createWriteStream(target);
      res.on('data', chunk => {
        seen += chunk.length;
        if (total && onProgress) onProgress(seen / total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ bytes: seen })));
      file.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('The download stalled.')));
  });
}

// ── Unpacking ─────────────────────────────────────────────────────────────────

/**
 * Expand-Archive rather than a zip library.
 *
 * It ships with Windows, handles the only archive format this project publishes,
 * and keeps the dependency list where it is. The alternative is an npm package
 * that has to be present inside the packaged app, which is one more thing that
 * can be missing at exactly the moment the app is trying to repair itself.
 */
function unzip(zipFile, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', `Expand-Archive -LiteralPath ${psLiteral(zipFile)} -DestinationPath ${psLiteral(destination)} -Force`,
    ], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Could not unpack the update: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

/**
 * The folder inside the unpacked archive that actually holds the app.
 *
 * Zipping `release/Milestone-win32-x64` can produce either shape depending on
 * how it was made — the files at the root, or one folder containing them — and
 * guessing wrong means copying a folder *into* the install directory instead of
 * over it, which is a broken app with no obvious cause.
 */
function findAppRoot(dir) {
  if (fs.existsSync(path.join(dir, 'Milestone.exe'))) return dir;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(dir, entry.name);
    if (fs.existsSync(path.join(nested, 'Milestone.exe'))) return nested;
  }
  return null;
}

// ── The check ─────────────────────────────────────────────────────────────────

/**
 * Ask GitHub, and fetch the build if there is a newer one.
 *
 * Downloading without being asked is deliberate: an update you have to remember
 * to request is the situation this replaces. Nothing is *applied* without a
 * restart, so the cost of being wrong is disk space.
 */
async function check({ manual = false } = {}) {
  if (!state.supported) return status();
  if (state.phase === 'checking' || state.phase === 'downloading') return status();
  // A build already waiting is the answer to "is there an update" — re-checking
  // would only re-download the same thing.
  if (state.phase === 'staged' && !manual) return status();

  setState({ phase: 'checking', error: null });
  try {
    const release = await getJson(RELEASE_API());
    const latest = String(release.tag_name || '').replace(/^v/, '');
    setState({ latestVersion: latest, checkedAt: new Date().toISOString() });

    if (!isNewer(latest, app.getVersion())) {
      log(`up to date (running ${app.getVersion()}, latest ${latest || 'unknown'})`);
      setState({ phase: 'idle' });
      return status();
    }
    if (state.stagedVersion && !isNewer(latest, state.stagedVersion)) {
      setState({ phase: 'staged' });
      return status();
    }

    const asset = (release.assets || []).find(a => /win32-x64.*\.zip$/i.test(a.name)) || (release.assets || []).find(a => /\.zip$/i.test(a.name));
    if (!asset) throw new Error('That release has no Windows build attached.');

    log(`downloading ${latest} from ${asset.name} (${asset.size} bytes)`);
    setState({ phase: 'downloading' });

    fs.mkdirSync(updatesDir(), { recursive: true });
    const zipFile = path.join(updatesDir(), `${latest}.zip`);
    const unpacked = path.join(updatesDir(), latest);
    discardStaged(unpacked);
    await download(asset.browser_download_url, zipFile);

    // A truncated download unpacks into something that looks almost right, so
    // check the size we were promised against the size we got before trusting it.
    const got = fs.statSync(zipFile).size;
    if (asset.size && got !== asset.size) throw new Error(`The download was incomplete (${got} of ${asset.size} bytes).`);

    await unzip(zipFile, unpacked);
    fs.rmSync(zipFile, { force: true });

    const root = findAppRoot(unpacked);
    if (!root) throw new Error('The downloaded build does not contain Milestone.exe.');

    setState({ phase: 'staged', staged: root, stagedVersion: latest, error: null });
    saveState();
    log(`staged ${latest} at ${root}`);
  } catch (err) {
    log(`check failed: ${err.message}`);
    // A failed check is not worth a dialog: the app is fine, it is merely still
    // the version it already was. The settings card shows it if you look.
    setState({ phase: state.staged ? 'staged' : 'idle', error: err.message });
  }
  return status();
}

// ── Applying ──────────────────────────────────────────────────────────────────

/**
 * The swap, as a script that outlives us.
 *
 * It has to run after this process is gone, so it cannot be part of this
 * process. PowerShell waits for the pid, copies the staged build over the
 * install directory, and starts the new exe.
 *
 * Copy-over rather than delete-then-copy, and a retry around it: antivirus and
 * Windows itself both hold files open for a moment after a process exits, and
 * "the update failed because a DLL was busy for 200ms" is not an acceptable way
 * to lose an application.
 *
 * The paths go in as PowerShell single-quoted literals (psQuote.cjs), not as
 * JSON. They are data being pasted into a program written in another language,
 * and the two disagree about what quoting means — see that file for what the
 * disagreement costs.
 */
function writeSwapScript(staged, target, exe, relaunch) {
  const script = `
$ErrorActionPreference = 'Stop'
$staged = ${psLiteral(staged)}
$target = ${psLiteral(target)}
$exe    = ${psLiteral(exe)}
$log    = ${psLiteral(logPath())}

function Note($m) { Add-Content -LiteralPath $log -Value ("{0}  [swap] {1}" -f (Get-Date -Format o), $m) }

try { Wait-Process -Id ${process.pid} -Timeout 90 } catch { }
Start-Sleep -Milliseconds 900

$ok = $false
for ($i = 1; $i -le 5; $i++) {
  try {
    Copy-Item -Path (Join-Path $staged '*') -Destination $target -Recurse -Force
    $ok = $true
    break
  } catch {
    Note "attempt $i failed: $($_.Exception.Message)"
    Start-Sleep -Seconds 2
  }
}

if ($ok) {
  Note "installed into $target"
  Remove-Item -LiteralPath $staged -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Note "gave up; the previous version is untouched and will start as before"
}
${relaunch ? 'Start-Process -FilePath $exe' : '# Quit, not restart: the update is installed and waiting for the next launch.'}
`;
  const file = path.join(updatesDir(), 'apply-update.ps1');
  fs.writeFileSync(file, script, 'utf8');
  return file;
}

/**
 * Hand the swap to a detached process and quit.
 *
 * Called two ways, and the difference between them is the whole reason for the
 * flag. "Restart to update" means put the new version on screen now, so the
 * script starts the app again when it is done. A staged build being taken on a
 * normal `before-quit` must *not* do that: you asked the app to close, and an
 * application that reopens itself because it happened to be updating is a worse
 * bug than a stale one.
 *
 * Idempotent — the second caller finds `applying` already set.
 */
let applying = false;
function applyStaged({ relaunch = true } = {}) {
  if (applying || !state.staged) return { ok: false, error: 'Nothing is staged.' };
  const target = path.dirname(app.getPath('exe'));
  const exe = app.getPath('exe');
  // The unpackaged tree runs out of the repo; overwriting that with a packaged
  // build would be destroying the source to install the binary.
  if (!app.isPackaged) return { ok: false, error: 'Not applicable to a development build.' };

  applying = true;
  try {
    const script = writeSwapScript(state.staged, target, exe, relaunch);
    log(`applying ${state.stagedVersion}: ${state.staged} -> ${target}`);
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();

    // The staged build has been handed over; forget it so a later launch does
    // not try to install it a second time.
    try { fs.writeFileSync(statePath(), JSON.stringify({ staged: null, stagedVersion: null }, null, 2)); } catch { /* best effort */ }
    if (relaunch) app.quit();
    return { ok: true };
  } catch (err) {
    applying = false;
    log(`could not start the swap: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/** True when a staged build is waiting, so `before-quit` knows to hand it over. */
const hasStaged = () => !!state.staged && !applying;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start() {
  loadState();
  if (!state.supported) {
    log(`updates off (packaged: ${app.isPackaged}, platform: ${process.platform})`);
    return;
  }
  setTimeout(() => { void check(); }, FIRST_CHECK_MS);
  setInterval(() => { void check(); }, CHECK_EVERY_MS);
}

module.exports = { start, check, status, onChange, applyStaged, hasStaged, isNewer };
