/**
 * Automatic backups for the browser build.
 *
 * The desktop app has had rolling snapshots on disk since the day its single
 * LevelDB turned out to be a single point of failure. The web build — the one on
 * GitHub Pages, the one a stranger tries first — had none at all, on the *more*
 * fragile store: browser localStorage dies to a "clear site data", to a storage
 * eviction under pressure, to a browser profile reset. Same failure, no net.
 *
 * So: the same rolling window, in IndexedDB. Deliberately a different database
 * from the one the stores use (they use localStorage), because a backup that
 * shares a fate with the thing it is backing up isn't one. IndexedDB survives
 * plenty that localStorage alone does not, and it is the only durable store a
 * page gets without asking permission for anything.
 *
 * It is not, and cannot be, as strong as the desktop's on-disk copies: clearing
 * site data takes both. The card in the Data panel says so, and points at Export
 * for anything that genuinely can't be lost.
 *
 * The shape of this module deliberately mirrors `window.electronAPI.backup`, so
 * lib/autoBackup.ts can pick whichever exists and everything above it — including
 * the restore UI — is identical on both.
 */

const DB_NAME = 'milestone-backups';
const DB_VERSION = 1;
const STORE = 'snapshots';

/** Matches electron/backups.cjs, so both builds keep the same depth of history. */
const KEEP = 14;

/** One stored row: the bundle plus what the restore picker lists it by. */
interface Row {
  name: string;
  savedAt: string;
  bytes: number;
  questlines: number;
  routines: number;
  bundle: MilestoneBundle;
}

/** Is there an IndexedDB to use at all? Absent in some private-browsing modes and
 *  in the jsdom the tests run under. */
export const webBackupAvailable = (): boolean =>
  typeof indexedDB !== 'undefined' && indexedDB !== null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the backup database.'));
  });
}

/** Promisified transaction request, closing the connection either way. */
function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Backup store request failed.'));
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Backup transaction aborted.')); };
  }));
}

/** How many questlines/tasks a bundle holds — surfaced in the picker so a
 *  snapshot taken *after* something went wrong is visible before you restore it. */
function counts(bundle: MilestoneBundle): { questlines: number; routines: number } {
  try {
    const state = bundle.quest ? JSON.parse(bundle.quest).state : null;
    return { questlines: state?.questlines?.length ?? 0, routines: state?.routines?.length ?? 0 };
  } catch {
    return { questlines: 0, routines: 0 };
  }
}

/** Newest-first, matching the desktop listing. */
export async function list(): Promise<AutoBackup[]> {
  if (!webBackupAvailable()) return [];
  try {
    const rows = await run<Row[]>('readonly', s => s.getAll() as IDBRequest<Row[]>);
    return rows
      .filter(r => r && r.name && r.bundle)
      .map(({ name, savedAt, bytes, questlines, routines }) => ({ name, savedAt, bytes, questlines, routines }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

/** Write a snapshot, unless an identical one is already the newest. An app opened
 *  five times in a day should leave one backup, not five — and an unchanged day
 *  must not push a good older snapshot out of the window. */
export async function save(bundle: MilestoneBundle): Promise<{ ok: boolean; name?: string; at?: string; skipped?: string; error?: string }> {
  if (!webBackupAvailable()) return { ok: false, error: 'This browser has no storage available for backups.' };
  if (!bundle || (!bundle.quest && !bundle.vynues)) return { ok: false, error: 'Nothing to back up.' };

  try {
    const existing = await list();
    if (existing.length) {
      const newest = await run<Row | undefined>('readonly', s => s.get(existing[0].name) as IDBRequest<Row | undefined>);
      // Compared by content rather than a hash: the payloads are strings already,
      // and an exact comparison can't collide.
      if (newest && newest.bundle.quest === bundle.quest && newest.bundle.vynues === bundle.vynues) {
        return { ok: true, skipped: 'unchanged', name: newest.name };
      }
    }

    const savedAt = bundle.exportedAt ?? new Date().toISOString();
    // Same naming as the desktop: sorts lexicographically in chronological order.
    const name = `auto-${savedAt.replace(/[:.]/g, '-').slice(0, 16)}.json`;
    const row: Row = {
      name, savedAt,
      bytes: (bundle.quest?.length ?? 0) + (bundle.vynues?.length ?? 0),
      ...counts(bundle),
      bundle,
    };
    await run('readwrite', s => s.put(row));

    // Rotate oldest-out, but only ever beyond the keep window.
    for (const stale of (await list()).slice(KEEP)) {
      try { await run('readwrite', s => s.delete(stale.name)); } catch { /* leave it */ }
    }

    return { ok: true, name, at: savedAt };
  } catch (e) {
    // A failed backup must never take the app down — it's insurance, not a
    // dependency. The card surfaces the message and the app carries on.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One snapshot's bundle, so the renderer restores it through the same path an
 *  imported file takes. */
export async function read(name: string): Promise<{ ok: boolean; bundle?: MilestoneBundle; error?: string }> {
  if (!webBackupAvailable()) return { ok: false, error: 'This browser has no storage available for backups.' };
  if (typeof name !== 'string' || !name) return { ok: false, error: 'Invalid backup name.' };
  try {
    const row = await run<Row | undefined>('readonly', s => s.get(name) as IDBRequest<Row | undefined>);
    return row?.bundle ? { ok: true, bundle: row.bundle } : { ok: false, error: 'That backup is missing.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
