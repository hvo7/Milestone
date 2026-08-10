/**
 * Keeps two (or more) copies of Milestone in step through a folder your cloud
 * drive already syncs. The folder plumbing lives in electron/cloudSync.cjs; this
 * is the half that decides *whose* data wins and applies the answer to the stores.
 *
 * ── How a device knows whether it's behind ──────────────────────────────────
 * Wall-clock timestamps are the obvious way to compare two versions and the
 * wrong one: two machines' clocks disagree, and "newer" says nothing about
 * whether one version actually *contains* the other. So each device carries a
 * vector clock — a count per device id — bumped on its own entry whenever it
 * publishes, and merged (max per entry) whenever it adopts someone else's data.
 * Comparing two clocks then answers the only question that matters:
 *
 *   ahead      — the peer has everything we have, plus more  → fast-forward, no loss
 *   behind     — we have everything the peer has, plus more  → re-publish so it catches up
 *   equal      — same version                                 → nothing to do
 *   concurrent — both edited without seeing the other         → a genuine conflict
 *
 * ── What happens on a genuine conflict ──────────────────────────────────────
 * The data model has no per-item edit times (a quest doesn't record when its
 * title changed), so there is no honest way to merge two divergent versions
 * item by item — a merge would have to guess whether a missing quest was
 * deleted over there or created over here. Rather than guess, the more recently
 * written version wins wholesale and the losing side is written to `backups/` in
 * the folder, in the same bundle format the Data panel's "Load backup" reads.
 * Nothing is silently dropped, and the UI says so. In practice this is rare: it
 * needs edits on both machines with no sync in between.
 */
import { create } from 'zustand';
import { QUEST_STORE_KEY, UI_STORE_KEY, useQuestStore, useUIStore } from '../store';
import { VYNUES_STORE_KEY, useVynuesStore } from '../vynuesStore';
import { APP_VERSION } from '../buildInfo';

type Clock = Record<string, number>;
type Slot = 'quest' | 'vynues' | 'ui';

export interface SyncDoc {
  _milestoneSync: 1;
  deviceId: string;
  deviceName: string;
  /** Informational, and the tiebreak when two versions are genuinely concurrent. */
  updatedAt: string;
  clock: Clock;
  stores: Partial<Record<Slot, string>>;
}

interface SyncConfig { enabled: boolean; folder: string; deviceId: string; deviceName: string; }

/** Minimal shape of a persisted zustand store — enough to push adopted state in
 *  without dragging each store's full state type across module boundaries. */
interface Settable { setState: (partial: object) => void }

const SLOTS: { slot: Slot; key: string; store: Settable }[] = [
  { slot: 'quest',  key: QUEST_STORE_KEY,  store: useQuestStore  as unknown as Settable },
  { slot: 'vynues', key: VYNUES_STORE_KEY, store: useVynuesStore as unknown as Settable },
  { slot: 'ui',     key: UI_STORE_KEY,     store: useUIStore     as unknown as Settable },
];

/** Local sync bookkeeping. Deliberately *not* in a synced store — this is what
 *  this device knows about the world, and copying it to another machine would
 *  make that machine claim to have seen edits it hasn't. */
const META_KEY = 'milestone-sync-meta';

// ── Status, for the settings card ─────────────────────────────────────────────

export interface SyncStatus {
  /** Desktop build with the sync bridge — false in a browser tab. */
  available: boolean;
  enabled: boolean;
  folder: string;
  deviceName: string;
  peers: { deviceName: string; updatedAt: string }[];
  lastSyncedAt: string | null;
  busy: boolean;
  error: string | null;
  /** Something the user should read once — a conflict, or a first-run adoption. */
  notice: string | null;
}

export const useSyncStatus = create<SyncStatus>(() => ({
  available: false, enabled: false, folder: '', deviceName: '',
  peers: [], lastSyncedAt: null, busy: false, error: null, notice: null,
}));

const setStatus = (patch: Partial<SyncStatus>) => useSyncStatus.setState(patch);
export const dismissNotice = () => setStatus({ notice: null });

// ── Vector clocks ─────────────────────────────────────────────────────────────

const at = (clock: Clock, key: string) => clock[key] ?? 0;

function compareClocks(a: Clock, b: Clock): 'ahead' | 'behind' | 'equal' | 'concurrent' {
  let ahead = false, behind = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (at(a, key) > at(b, key)) ahead = true;
    else if (at(a, key) < at(b, key)) behind = true;
  }
  return ahead && behind ? 'concurrent' : ahead ? 'ahead' : behind ? 'behind' : 'equal';
}

function mergeClocks(a: Clock, b: Clock): Clock {
  const out: Clock = { ...a };
  for (const key of Object.keys(b)) out[key] = Math.max(at(a, key), at(b, key));
  return out;
}

// ── Local state ───────────────────────────────────────────────────────────────

let config: SyncConfig | null = null;
/** Set while remote data is being written into the stores, so the store
 *  subscriptions below don't mistake an adoption for a local edit and publish
 *  it straight back out. */
let applying = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pullChain: Promise<void> = Promise.resolve();

const bridge = () => window.electronAPI?.sync;

function loadMeta(): { clock: Clock } {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.clock === 'object' && parsed.clock) return { clock: parsed.clock as Clock };
  } catch { /* corrupt meta is recoverable — start from an empty clock */ }
  return { clock: {} };
}

const saveMeta = (meta: { clock: Clock }) => localStorage.setItem(META_KEY, JSON.stringify(meta));

/** The three persisted stores exactly as they sit in localStorage. Shipping the
 *  raw strings (rather than re-serialising parsed state) keeps this byte-identical
 *  to what the Backup & Restore bundle carries, so both paths stay interchangeable. */
function snapshot(): Partial<Record<Slot, string>> {
  const stores: Partial<Record<Slot, string>> = {};
  for (const { slot, key } of SLOTS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) stores[slot] = raw;
  }
  return stores;
}

/** Writes an incoming version into localStorage *and* into the live stores, so
 *  an edit made on the other computer appears without a restart. */
function applyStores(stores: Partial<Record<Slot, string>>) {
  applying = true;
  try {
    for (const { slot, key, store } of SLOTS) {
      const raw = stores[slot];
      if (typeof raw !== 'string') continue;
      localStorage.setItem(key, raw);
      try {
        const parsed = JSON.parse(raw);
        // zustand's persist wraps state as { state, version }.
        if (parsed && typeof parsed.state === 'object' && parsed.state) store.setState(parsed.state);
      } catch { /* leave the store as-is; the raw value is still on disk for next launch */ }
    }
    // Theme is applied to <html> imperatively on toggle, so adopting a different
    // theme has to re-assert it — setState alone won't repaint the attribute.
    const theme = useUIStore.getState().theme;
    document.documentElement.setAttribute('data-theme', theme);
  } finally {
    applying = false;
  }
}

const backupBundle = () => {
  const stores = snapshot();
  return { _milestone: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), quest: stores.quest, vynues: stores.vynues };
};

// ── Publish ───────────────────────────────────────────────────────────────────

/**
 * Writes this device's document to the folder.
 * `bump` advances our own clock entry — true for a real local edit, false when
 * we're only re-stating a version a peer already ought to have.
 */
async function publish(bump: boolean) {
  const api = bridge();
  if (!api || !config?.enabled) return;

  const meta = loadMeta();
  if (bump) meta.clock[config.deviceId] = at(meta.clock, config.deviceId) + 1;
  saveMeta(meta);

  const doc: SyncDoc = {
    _milestoneSync: 1,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    updatedAt: new Date().toISOString(),
    clock: meta.clock,
    stores: snapshot(),
  };

  const res = await api.write(doc);
  if (res.ok) setStatus({ lastSyncedAt: res.at ?? new Date().toISOString(), error: null });
  else setStatus({ error: res.error ?? 'Could not write to the sync folder.' });
}

function scheduleWrite() {
  if (applying || !config?.enabled) return;
  if (writeTimer) clearTimeout(writeTimer);
  // Long enough that typing a task title is one write rather than twenty, short
  // enough that walking to the other computer finds the change already there.
  writeTimer = setTimeout(() => { writeTimer = null; void publish(true); }, 1500);
}

// ── Pull ──────────────────────────────────────────────────────────────────────

/** Of two peer documents, the one that supersedes the other — or, if neither
 *  does, the more recently written. */
function preferred(a: SyncDoc, b: SyncDoc): SyncDoc {
  const rel = compareClocks(a.clock, b.clock);
  if (rel === 'ahead') return a;
  if (rel === 'behind') return b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

async function adopt(doc: SyncDoc, opts: { conflict: boolean }) {
  const api = bridge();
  if (opts.conflict && api) {
    // This machine's version is about to be replaced by one that isn't a
    // descendant of it, so park a restorable copy before it goes.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const res = await api.writeBackup(`${config?.deviceName ?? 'device'}-${stamp}.json`, backupBundle());
    setStatus({
      notice: res.ok
        ? `Both computers had been edited since the last sync, so “${doc.deviceName}” (the more recent) was used. This computer's version was saved to backups/ in the sync folder — restore it with Load backup if it was the one you wanted.`
        : `Both computers had been edited since the last sync, so “${doc.deviceName}” (the more recent) was used. This computer's version could NOT be backed up: ${res.error}`,
    });
  }

  applyStores(doc.stores);

  const meta = loadMeta();
  meta.clock = mergeClocks(meta.clock, doc.clock);
  saveMeta(meta);
  setStatus({ lastSyncedAt: new Date().toISOString(), error: null });

  // Record that we've seen it, so the next comparison is 'equal' rather than a
  // second conflict over the same divergence.
  await publish(false);
}

async function pullOnce() {
  const api = bridge();
  if (!api || !config?.enabled) return;

  const res = await api.readPeers();
  if (!res.ok) { setStatus({ error: res.error ?? 'Could not read the sync folder.' }); return; }

  const peers = (res.peers ?? []) as SyncDoc[];
  setStatus({
    error: null,
    peers: peers.map(p => ({ deviceName: p.deviceName, updatedAt: p.updatedAt })),
  });

  if (peers.length === 0) { await publish(false); return; } // nobody else yet — make sure we're on record

  const winner = peers.reduce(preferred);
  const meta = loadMeta();
  switch (compareClocks(winner.clock, meta.clock)) {
    case 'equal':  break;
    case 'behind': await publish(false); break;             // peer is out of date — re-state ours
    case 'ahead':  await adopt(winner, { conflict: false }); break;
    // Both sides edited without seeing each other. `preferred` already picked the
    // more recently written of the peers; adopt handles the rescue copy.
    case 'concurrent': await adopt(winner, { conflict: true }); break;
  }
}

/** Serialised so a burst of watcher events can't run two reconciliations over
 *  the same stores at once. */
function pull() {
  pullChain = pullChain.then(pullOnce).catch(err => {
    setStatus({ error: err instanceof Error ? err.message : String(err) });
  });
  return pullChain;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Called once at startup. Safe to call in a browser (no bridge → no-op). */
export async function startCloudSync() {
  const api = bridge();
  if (!api) return;

  config = await api.getConfig();
  setStatus({
    available: true,
    enabled: config.enabled,
    folder: config.folder,
    deviceName: config.deviceName,
  });

  for (const { store } of SLOTS) {
    (store as unknown as { subscribe: (fn: () => void) => void }).subscribe(scheduleWrite);
  }

  api.onChanged(() => { void pull(); });

  // Belt and braces around the watcher: cloud clients can materialise a file in
  // ways fs.watch doesn't report, and coming back to a machine you left open is
  // exactly when you most expect it to have caught up.
  window.addEventListener('focus', () => { void pull(); });
  setInterval(() => { void pull(); }, 60_000);

  if (config.enabled) await pull();
}

/**
 * Turns sync on for a chosen folder.
 * `mode` settles the one moment where data can be lost outright — the folder
 * already holds another computer's data and this one has data of its own:
 *   'adopt' — take what's in the folder, replacing this computer's data
 *   'push'  — publish this computer's data, replacing what the peers hold
 */
export async function enableSync(folder: string, mode: 'adopt' | 'push') {
  const api = bridge();
  if (!api) return;

  config = await api.setConfig({ enabled: true, folder });
  setStatus({ enabled: true, folder: config.folder, busy: true, error: null, notice: null });

  try {
    const res = await api.readPeers();
    const peers = (res.ok ? res.peers ?? [] : []) as SyncDoc[];

    if (mode === 'push') {
      // Absorb every peer's clock, then bump: the result strictly supersedes all
      // of them, so they fast-forward to us instead of seeing a conflict.
      const meta = loadMeta();
      for (const peer of peers) meta.clock = mergeClocks(meta.clock, peer.clock);
      saveMeta(meta);
      await publish(true);
      if (peers.length) setStatus({ notice: 'This computer\'s data is now the shared copy. The other computer will pick it up next time it syncs.' });
    } else if (peers.length) {
      const winner = peers.reduce(preferred);
      // Explicitly discarding this machine's data, so keep a rescue copy.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await api.writeBackup(`${config.deviceName}-before-adopt-${stamp}.json`, backupBundle());
      await adopt(winner, { conflict: false });
      setStatus({ notice: `Loaded the data from “${winner.deviceName}”. This computer's previous data was saved to backups/ in the sync folder.` });
    } else {
      await publish(true);
    }
    setStatus({ peers: peers.map(p => ({ deviceName: p.deviceName, updatedAt: p.updatedAt })) });
  } finally {
    setStatus({ busy: false });
  }
}

export async function disableSync() {
  const api = bridge();
  if (!api) return;
  config = await api.setConfig({ enabled: false });
  setStatus({ enabled: false, peers: [] });
}

/** Manual "Sync now". */
export async function syncNow() {
  setStatus({ busy: true });
  try { await pull(); } finally { setStatus({ busy: false }); }
}

/** Peers found in the folder, for the enable-time choice. */
export async function peekFolder(folder: string): Promise<{ deviceName: string; updatedAt: string }[]> {
  const api = bridge();
  if (!api) return [];
  // readPeers reads the *saved* folder, so record the choice before looking.
  config = await api.setConfig({ folder });
  const res = await api.readPeers();
  return res.ok ? ((res.peers ?? []) as SyncDoc[]).map(p => ({ deviceName: p.deviceName, updatedAt: p.updatedAt })) : [];
}

/**
 * Announces a write that bypassed the stores — importing a backup file replaces
 * localStorage wholesale. Without this the imported data would carry the old
 * clock, and the next pull would read it as stale and overwrite it.
 */
export function noteExternalWrite() {
  if (!config?.enabled) return;
  void publish(true);
}
