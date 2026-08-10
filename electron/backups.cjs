/**
 * Automatic local backups.
 *
 * Every quest, streak and project lives in exactly one place — the Chromium
 * LevelDB under %APPDATA%/Milestone/Local Storage. That store can be recreated
 * empty (a reset profile, a corrupted database, a bad migration), and when it is,
 * there is nothing to fall back to: the data is simply gone. That happened once,
 * and the only reason it was recoverable is that an *older* profile happened to
 * still be sitting on disk.
 *
 * So the renderer hands us a snapshot on launch and after edits settle, and we
 * keep a rolling window of them on disk beside the profile. Deliberately the same
 * bundle format the Data panel's Export writes, so a recovery is "Load backup"
 * rather than a support conversation.
 *
 * Nothing here ever deletes a snapshot that isn't older than KEEP others — the
 * whole point is to be the copy that survives when the live store doesn't.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** How many daily snapshots to keep. Two weeks is long enough to notice that
 *  something went wrong and still have a pre-breakage copy. */
const KEEP = 14;

const dir = () => path.join(app.getPath('userData'), 'backups');

const fingerprint = (bundle) =>
  crypto.createHash('sha1').update(JSON.stringify({ q: bundle.quest, v: bundle.vynues })).digest('hex');

/** Snapshots newest-first. Anything unparseable is ignored rather than fatal —
 *  a half-written file must not break the listing that would let you restore. */
function list() {
  let names;
  try {
    names = fs.readdirSync(dir()).filter(n => n.startsWith('auto-') && n.endsWith('.json'));
  } catch {
    return []; // no backups yet
  }
  const out = [];
  for (const name of names) {
    const file = path.join(dir(), name);
    try {
      const stat = fs.statSync(file);
      const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!bundle || !bundle._milestone) continue;
      const state = bundle.quest ? JSON.parse(bundle.quest).state : null;
      out.push({
        name,
        savedAt: bundle.exportedAt ?? stat.mtime.toISOString(),
        bytes: stat.size,
        // Surfaced in the restore list so you can tell a healthy snapshot from
        // one taken after something had already gone wrong.
        questlines: state?.questlines?.length ?? 0,
        routines: state?.routines?.length ?? 0,
      });
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * Writes today's snapshot, unless an identical one is already the newest — an
 * app opened five times in a day should leave one backup, not five, and an
 * unchanged day shouldn't push a good older snapshot out of the window.
 */
function save(bundle) {
  if (!bundle || (!bundle.quest && !bundle.vynues)) {
    return { ok: false, error: 'Nothing to back up.' };
  }
  try {
    fs.mkdirSync(dir(), { recursive: true });

    const existing = list();
    if (existing.length) {
      try {
        const newest = JSON.parse(fs.readFileSync(path.join(dir(), existing[0].name), 'utf8'));
        if (fingerprint(newest) === fingerprint(bundle)) {
          return { ok: true, skipped: 'unchanged', name: existing[0].name };
        }
      } catch { /* unreadable newest — fall through and write a fresh one */ }
    }

    // Date-stamped to the minute: one file per save, sorting lexicographically
    // in the same order as chronologically.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const name = `auto-${stamp}.json`;
    const temp = path.join(dir(), `.${name}.tmp`);
    // Write-then-rename: a snapshot half-written during a crash must not be the
    // thing you reach for later.
    fs.writeFileSync(temp, JSON.stringify(bundle), 'utf8');
    fs.renameSync(temp, path.join(dir(), name));

    // Rotate oldest-out, but only ever beyond the keep window.
    for (const stale of list().slice(KEEP)) {
      try { fs.unlinkSync(path.join(dir(), stale.name)); } catch { /* leave it */ }
    }

    return { ok: true, name, at: new Date().toISOString() };
  } catch (e) {
    // A failed backup must never take the app down — it's insurance, not a
    // dependency. The renderer surfaces the message and carries on.
    return { ok: false, error: e.message };
  }
}

/** The bundle for one snapshot, so the renderer can restore it through exactly
 *  the same code path as an imported file. */
function read(name) {
  // Defend the read against a crafted name — this is renderer-supplied input and
  // must not be able to walk out of the backups folder.
  if (typeof name !== 'string' || path.basename(name) !== name) {
    return { ok: false, error: 'Invalid backup name.' };
  }
  try {
    return { ok: true, bundle: JSON.parse(fs.readFileSync(path.join(dir(), name), 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { save, list, read, folder: dir };
