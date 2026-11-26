/**
 * The emergency layer under sync: copies of this device's data taken before
 * sync (or a recovery action) changes it, and a switch that stops sync without
 * stopping the app.
 *
 * Snapshots live in IndexedDB rather than localStorage. They are whole copies,
 * and on an iPhone localStorage holds only a few megabytes for everything — the
 * stores themselves included. Where IndexedDB is missing (tests, a locked-down
 * browser), they are kept in memory for the session: still enough to undo a
 * merge you just watched happen.
 */
const DB = 'milestone-sync-safety';
const STORE = 'snapshots';
const PAUSED_KEY = 'milestone-sync-paused';

/** Newest kept in full; older ones thinned to one a day. */
const KEEP_RECENT = 30;
const KEEP_DAYS = 21;

export interface SafetySnapshot {
  id: string;
  at: string;
  /** Why it was taken: "Before taking changes from Phone". */
  reason: string;
  stores: Record<string, string | undefined>;
}
export type SnapshotSummary = Omit<SafetySnapshot, 'stores'> & { items: number };

// ── Pause ─────────────────────────────────────────────────────────────────────

export function isSyncPaused(): boolean {
  try { return localStorage.getItem(PAUSED_KEY) === '1'; } catch { return false; }
}

export function setSyncPausedFlag(paused: boolean): void {
  if (paused) localStorage.setItem(PAUSED_KEY, '1');
  else localStorage.removeItem(PAUSED_KEY);
}

// ── Storage ───────────────────────────────────────────────────────────────────

const memory = new Map<string, SafetySnapshot>();
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise(resolve => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(db => db ? new Promise<T | null>(resolve => {
    try {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  }) : null);
}

async function all(): Promise<SafetySnapshot[]> {
  const stored = await run<SafetySnapshot[]>('readonly', store => store.getAll() as IDBRequest<SafetySnapshot[]>);
  const list = stored ?? [...memory.values()];
  return list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const countItems = (stores: SafetySnapshot['stores']) =>
  Object.values(stores).reduce((sum, raw) => sum + (raw ? (raw.match(/"id":/g)?.length ?? 0) : 0), 0);

/** Which snapshots to let go: beyond the newest few, keep one per day for a
 *  few weeks. A merge gone wrong is noticed within days, not months. */
export function expired(list: { id: string; at: string }[], now = Date.now()): string[] {
  const out: string[] = [];
  const days = new Set<string>();
  list.forEach((snapshot, index) => {
    if (index < KEEP_RECENT) { days.add(snapshot.at.slice(0, 10)); return; }
    const day = snapshot.at.slice(0, 10);
    if (Date.parse(snapshot.at) < now - KEEP_DAYS * 86_400_000 || days.has(day)) out.push(snapshot.id);
    else days.add(day);
  });
  return out;
}

let last: { signature: string; snapshot: SafetySnapshot } | null = null;

/** Keeps a copy of `stores`. A copy identical to the previous one is not stored
 *  twice; it takes the newer, more specific reason instead ("Before taking
 *  changes from Phone" says more than "When Milestone opened"). */
export async function saveSafetySnapshot(reason: string, stores: SafetySnapshot['stores']): Promise<void> {
  const signature = JSON.stringify(stores);
  if (last?.signature === signature) {
    // The same object the first save is (perhaps still) storing.
    last.snapshot.reason = reason;
    const renamed = last.snapshot;
    await run('readwrite', store => store.put(renamed));
    return;
  }
  const at = new Date().toISOString();
  const snapshot: SafetySnapshot = { id: `${at}-${Math.random().toString(36).slice(2, 8)}`, at, reason, stores };
  last = { signature, snapshot };
  const saved = await run('readwrite', store => store.put(snapshot));
  if (saved === null) memory.set(snapshot.id, snapshot);
  const old = expired(await all());
  for (const id of old) { memory.delete(id); await run('readwrite', store => store.delete(id)); }
}

export async function listSafetySnapshots(): Promise<SnapshotSummary[]> {
  return (await all()).map(({ stores, ...rest }) => ({ ...rest, items: countItems(stores) }));
}

export async function loadSafetySnapshot(id: string): Promise<SafetySnapshot | null> {
  return (await run<SafetySnapshot>('readonly', store => store.get(id) as IDBRequest<SafetySnapshot>)) ?? memory.get(id) ?? null;
}

/** For tests: forget everything held in memory. */
export function resetSafetyForTests(): void { memory.clear(); last = null; opening = null; }
