/**
 * Last-resort recovery: pulls Milestone's stores straight out of a Chromium
 * LevelDB profile and writes them as a backup bundle you can load in the app.
 *
 * For when the app can't reach the data itself — a profile that was reset, a
 * pre-rename `rpg-quest-tracker` folder left behind by an old build, or a copy
 * of %APPDATA%/Milestone rescued from a dying machine. It reads only; the
 * profile it points at is never modified.
 *
 *   node scripts/recover-profile.mjs                      # scans the usual places
 *   node scripts/recover-profile.mjs <profile-dir>        # a specific profile
 *   node scripts/recover-profile.mjs <profile-dir> <out>  # ...and where to write
 *
 * Load the result with Sync & Backup -> Load backup.
 *
 * ── Why this is not a two-line script ────────────────────────────────────────
 * A naive scan for printable runs returns fragments, because Chromium stores
 * these values as UTF-16LE behind a one-byte encoding tag, and because LevelDB's
 * write-ahead log chops records across 32KiB block boundaries. So the log is
 * parsed properly: blocks -> records -> reassembled write batches -> key/value
 * pairs, keeping the newest value for each key.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BLOCK = 32768;
const QUEST_KEYS  = ['milestone-v1', 'rpg-quest-tracker-v1'];
const VYNUES_KEYS = ['milestone-vynues-v1', 'vynues-v1'];

/** LevelDB log records: [crc:4][len:2][type:1][payload], 1=FULL 2=FIRST 3=MID 4=LAST. */
function logRecords(buf) {
  const out = [];
  let pending = null;
  for (let base = 0; base < buf.length; base += BLOCK) {
    const end = Math.min(base + BLOCK, buf.length);
    let p = base;
    while (p + 7 <= end) {
      const len = buf.readUInt16LE(p + 4);
      const type = buf[p + 6];
      if (type === 0 && len === 0) break;          // zero padding to end of block
      if (p + 7 + len > end) break;                // truncated tail
      const data = buf.subarray(p + 7, p + 7 + len);
      if (type === 1) out.push(data);
      else if (type === 2) pending = [data];
      else if (type === 3 && pending) pending.push(data);
      else if (type === 4 && pending) { pending.push(data); out.push(Buffer.concat(pending)); pending = null; }
      p += 7 + len;
    }
  }
  return out;
}

function varint(buf, pos) {
  let result = 0, shift = 0;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

/** Chromium tags stored strings: 0 => UTF-16LE payload, 1 => Latin-1/UTF-8. */
function decode(buf) {
  if (buf.length === 0) return '';
  return buf[0] === 0 ? buf.subarray(1).toString('utf16le') : buf.subarray(1).toString('utf8');
}

/** Write batch: [seq:8][count:4] then [kind:1][varint klen][key]([varint vlen][val]). */
function parseBatch(batch, sink) {
  let p = 12;
  while (p < batch.length) {
    const kind = batch[p++];
    if (kind !== 0 && kind !== 1) break;
    let keyLen, valLen;
    [keyLen, p] = varint(batch, p);
    if (p + keyLen > batch.length) break;
    const key = batch.subarray(p, p + keyLen); p += keyLen;
    if (kind === 1) {
      [valLen, p] = varint(batch, p);
      if (p + valLen > batch.length) break;
      const val = batch.subarray(p, p + valLen); p += valLen;
      sink(key.toString('latin1'), decode(val));
    } else {
      sink(key.toString('latin1'), null);
    }
  }
}

/** Every live key/value in a profile's Local Storage. */
function readProfile(profileDir) {
  const leveldb = path.join(profileDir, 'Local Storage', 'leveldb');
  const latest = new Map();
  let files;
  try {
    files = fs.readdirSync(leveldb).filter(f => f.endsWith('.log')).sort();
  } catch {
    return latest;
  }
  for (const f of files) {
    for (const batch of logRecords(fs.readFileSync(path.join(leveldb, f)))) {
      parseBatch(batch, (k, v) => { if (v === null) latest.delete(k); else latest.set(k, v); });
    }
  }
  return latest;
}

/** Keys carry an origin prefix, so match on the suffix rather than equality. */
function pick(map, names) {
  for (const [k, v] of map) {
    if (!names.some(n => k.endsWith(n))) continue;
    try { JSON.parse(v); return v; } catch { /* not the value we want */ }
  }
  return undefined;
}

function describe(questJson) {
  if (!questJson) return '  (no quest data)';
  try {
    const s = JSON.parse(questJson).state ?? {};
    const lines = [
      `  questlines:     ${(s.questlines ?? []).length}`,
      `  routines:       ${(s.routines ?? []).length}`,
      `  logged days:    ${Object.keys(s.completionLog ?? {}).length}`,
    ];
    for (const ql of s.questlines ?? []) lines.push(`    - ${ql.title} (${(ql.quests ?? []).length} quests)`);
    return lines.join('\n');
  } catch {
    return '  (unreadable)';
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const appData = process.env.APPDATA
  ?? path.join(os.homedir(), 'AppData', 'Roaming');            // Windows default

const candidates = process.argv[2]
  ? [process.argv[2]]
  : [path.join(appData, 'Milestone'), path.join(appData, 'rpg-quest-tracker')];

let best = null;
for (const dir of candidates) {
  const map = readProfile(dir);
  const quest = pick(map, QUEST_KEYS);
  const vynues = pick(map, VYNUES_KEYS);
  if (!quest && !vynues) {
    console.log(`\n${dir}\n  no Milestone data found`);
    continue;
  }
  console.log(`\n${dir}`);
  console.log(describe(quest));
  // Prefer whichever profile actually carries the most work, not whichever came
  // first — the point of this script is usually that the "current" one is empty.
  const score = quest ? JSON.parse(quest).state?.questlines?.length ?? 0 : 0;
  if (!best || score > best.score) best = { dir, quest, vynues, score };
}

if (!best) {
  console.error('\nNo Milestone data found in any profile. Pass a profile directory explicitly:');
  console.error('  node scripts/recover-profile.mjs "C:\\path\\to\\profile"');
  process.exit(1);
}

const bundle = {
  _milestone: 2,
  appVersion: 'recovered',
  exportedAt: new Date().toISOString(),
  quest: best.quest,
  vynues: best.vynues ?? JSON.stringify({ state: { projects: [] }, version: 0 }),
};

// Defaults to the home directory, never the working directory: this file is a
// verbatim dump of personal task data, and the working directory is usually the
// checkout — which is exactly where it must not land.
const out = process.argv[3]
  ?? path.join(os.homedir(), `milestone-recovered-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(bundle), 'utf8');

console.log(`\nRecovered from: ${best.dir}`);
console.log(`Written to:     ${out}`);
console.log('\nRestore it with Sync & Backup -> Load backup.');
