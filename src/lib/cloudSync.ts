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
 * ── Slots are tracked independently ─────────────────────────────────────────
 * The three persisted stores — quests, Vynues projects, UI preferences — are
 * unrelated to each other, so each carries its own clock. Editing a quest here
 * while a Vynues task was edited there is not a conflict: each side is simply
 * ahead on a different slot, and both fast-forward. Only a slot edited on *both*
 * machines is a genuine conflict, and only that slot pays for it.
 *
 * A single doc-level clock (what this used to be) collapsed all three together
 * and made any pair of unrelated edits look like a conflict, throwing away one
 * side's quests to resolve a disagreement about the theme.
 *
 * ── What happens on a genuine conflict ──────────────────────────────────────
 * The data model has no per-item edit times (a quest doesn't record when its
 * title changed), so there is no honest way to merge two divergent versions of
 * one slot item by item — a merge would have to guess whether a missing quest
 * was deleted over there or created over here. Rather than guess, the more
 * recently written version of *that slot* wins and the losing copy is written to
 * `backups/` in the folder, in the same bundle format the Data panel's "Load
 * backup" reads. Nothing is silently dropped, and the UI says so.
 *
 * ── Talking to older builds ─────────────────────────────────────────────────
 * A doc written before per-slot clocks has only `clock`. It's read as though
 * every slot carried that clock, which is exactly what it meant, so a machine
 * still on the old build converges correctly — it just can't benefit from the
 * finer granularity until it updates.
 */
import { create } from 'zustand';
import { QUEST_STORE_KEY, UI_STORE_KEY, useQuestStore, useUIStore } from '../store';
import { VYNUES_STORE_KEY, useVynuesStore } from '../vynuesStore';
import { APP_VERSION } from '../buildInfo';
import { withoutHistory, clearHistory } from './history';
import { httpBridge, compositeBridge, servedByMilestone, identity, rememberToken, type SyncBridge } from './phoneTransport';
import { loadRelay, relayConfigured } from './relay';

export type Clock = Record<string, number>;
export type Slot = 'quest' | 'vynues' | 'ui';

export const SLOT_NAMES: Slot[] = ['quest', 'vynues', 'ui'];

export interface SyncDoc {
  _milestoneSync: 1;
  deviceId: string;
  deviceName: string;
  /** Informational, and the tiebreak when two versions are genuinely concurrent. */
  updatedAt: string;
  /** Doc-level clock. Kept for builds that predate `slotClocks`, and written as
   *  the union of the slot clocks so those builds still converge. */
  clock: Clock;
  /** Per-slot clocks. Absent on documents written by older builds. */
  slotClocks?: Partial<Record<Slot, Clock>>;
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
  /** True in a browser rather than the desktop app — a phone, or a tab. The
   *  reconciliation is identical; the wording isn't. */
  overWifi: boolean;
  /** True when this copy has some route to its other copies. False means it is
   *  working alone: everything still saves, nothing is being exchanged. */
  linked: boolean;
}

export const useSyncStatus = create<SyncStatus>(() => ({
  available: false, enabled: false, folder: '', deviceName: '',
  peers: [], lastSyncedAt: null, busy: false, error: null, notice: null, overWifi: false, linked: false,
}));

const setStatus = (patch: Partial<SyncStatus>) => useSyncStatus.setState(patch);
export const dismissNotice = () => setStatus({ notice: null });

// ── Vector clocks ─────────────────────────────────────────────────────────────

const at = (clock: Clock, key: string) => clock[key] ?? 0;

export type ClockRelation = 'ahead' | 'behind' | 'equal' | 'concurrent';

export function compareClocks(a: Clock, b: Clock): ClockRelation {
  let ahead = false, behind = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (at(a, key) > at(b, key)) ahead = true;
    else if (at(a, key) < at(b, key)) behind = true;
  }
  return ahead && behind ? 'concurrent' : ahead ? 'ahead' : behind ? 'behind' : 'equal';
}

export function mergeClocks(a: Clock, b: Clock): Clock {
  const out: Clock = { ...a };
  for (const key of Object.keys(b)) out[key] = Math.max(at(a, key), at(b, key));
  return out;
}

/** A document's clock for one slot. Older documents have only the doc-level
 *  clock, which stood for all three slots at once — so that is what they get. */
export const slotClock = (doc: Pick<SyncDoc, 'clock' | 'slotClocks'>, slot: Slot): Clock =>
  doc.slotClocks?.[slot] ?? doc.clock ?? {};

/** The doc-level clock to publish alongside per-slot ones: the union, so a build
 *  that only understands `clock` still sees us move forward whenever any slot does. */
export const unionClocks = (slots: Partial<Record<Slot, Clock>>): Clock =>
  SLOT_NAMES.reduce<Clock>((acc, slot) => mergeClocks(acc, slots[slot] ?? {}), {});

// ── Local state ───────────────────────────────────────────────────────────────

let config: SyncConfig | null = null;
/** Set while remote data is being written into the stores, so the store
 *  subscriptions below don't mistake an adoption for a local edit and publish
 *  it straight back out. */
let applying = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pullChain: Promise<void> = Promise.resolve();

/**
 * Where documents are exchanged.
 *
 * The desktop uses the Electron bridge (a folder the cloud drive carries, plus
 * the phone server this computer runs). A phone has no bridge, but if the page
 * was served by a Milestone desktop it can reach the same documents over HTTP —
 * see lib/phoneTransport.ts. Either way the reconciler below is unchanged: it
 * asks for peers, writes its own document, and decides per slot.
 */
let transport: SyncBridge | null = null;
const bridge = () => transport ?? (window.electronAPI?.sync as SyncBridge | undefined) ?? null;

/**
 * Every route this device has to its other copies, as one bridge.
 *
 * A desktop has the cloud folder and the Wi-Fi server (both behind the Electron
 * bridge) and, if you set one up, the relay. A phone has the relay and — when it
 * is home — the desktop that served it. Reads take the union and writes go
 * everywhere, so which routes happen to be up is not something the reconciler
 * has to think about.
 */
async function buildTransport(): Promise<SyncBridge | null> {
  const parts: SyncBridge[] = [];
  const local = window.electronAPI?.sync as SyncBridge | undefined;
  if (local) parts.push(local);

  // A page served by a desktop or a relay can always reach the endpoint it came
  // from, at the origin it came from.
  if (!local && await servedByMilestone()) {
    parts.push(httpBridge({ token: rememberToken(), me: identity() }));
  }

  const relay = loadRelay();
  // Not added twice: a phone that loaded the app *from* the relay is already
  // talking to it through the line above.
  const servedByRelay = !local && relay.url && location.origin.startsWith(relay.url);
  if (relayConfigured(relay) && !servedByRelay) {
    parts.push(httpBridge({
      base: relay.url,
      token: relay.token,
      // The desktop's own identity, so the relay leaves its document out of the
      // peer list rather than handing this machine back its own clock.
      me: local ? await local.getConfig() : identity(),
      // The desktop's own identity comes from Electron, and its poll comes from
      // the folder watcher; a second timer would only duplicate the work.
      poll: !local,
    }));
  }

  if (!parts.length) return null;
  // A single route needs no wrapper, and the desktop's own bridge must stay
  // itself — enableSync and friends reach for it directly.
  return parts.length === 1 && local ? null : compositeBridge(parts);
}

interface Meta {
  /** What this device believes it has seen, per slot. */
  slots: Record<Slot, Clock>;
  /** Last published content per slot, so a publish only bumps slots that moved.
   *  Without this every write would advance all three and re-create exactly the
   *  false conflicts per-slot clocks exist to avoid. */
  published: Partial<Record<Slot, string>>;
}

const emptyMeta = (): Meta => ({ slots: { quest: {}, vynues: {}, ui: {} }, published: {} });

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.slots) {
      const meta = emptyMeta();
      for (const slot of SLOT_NAMES) {
        if (parsed.slots[slot] && typeof parsed.slots[slot] === 'object') meta.slots[slot] = parsed.slots[slot] as Clock;
      }
      if (parsed.published && typeof parsed.published === 'object') meta.published = parsed.published;
      return meta;
    }
    // Upgrade from the single-clock format: that one clock described all three
    // slots, so seed each with it rather than starting from zero (which would
    // read as "never seen anything" and re-adopt a peer we're already level with).
    if (parsed && typeof parsed.clock === 'object' && parsed.clock) {
      const meta = emptyMeta();
      for (const slot of SLOT_NAMES) meta.slots[slot] = { ...parsed.clock as Clock };
      return meta;
    }
  } catch { /* corrupt meta is recoverable — start from an empty clock */ }
  return emptyMeta();
}

const saveMeta = (meta: Meta) => localStorage.setItem(META_KEY, JSON.stringify(meta));

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
  // Outside the undo history, and it *clears* it. Adopting the other computer's
  // data makes every local step meaningless: those snapshots describe a state
  // this profile is no longer in, and restoring one would throw away what just
  // arrived — then sync that loss back over the wire.
  clearHistory();
  return withoutHistory(() => {
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
  });
}

const backupBundle = () => {
  const stores = snapshot();
  return { _milestone: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), quest: stores.quest, vynues: stores.vynues };
};

// ── Publish ───────────────────────────────────────────────────────────────────

/**
 * Writes this device's document to the folder.
 *
 * `bump` advances our own entry — true for a real local edit, false when we're
 * only re-stating a version a peer already ought to have. Even on a real edit,
 * only slots whose *content* changed since our last publish move: bumping a slot
 * nobody touched would tell peers we have news about it, and manufacture the
 * conflicts this design exists to avoid.
 */
async function publish(bump: boolean) {
  const api = bridge();
  if (!api || !config?.enabled) return;

  const meta = loadMeta();
  const stores = snapshot();

  if (bump) {
    for (const slot of SLOT_NAMES) {
      const current = stores[slot];
      if (current === meta.published[slot]) continue;      // untouched slot
      meta.slots[slot] = { ...meta.slots[slot], [config.deviceId]: at(meta.slots[slot], config.deviceId) + 1 };
    }
  }
  meta.published = { ...stores };
  saveMeta(meta);

  const doc: SyncDoc = {
    _milestoneSync: 1,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    updatedAt: new Date().toISOString(),
    clock: unionClocks(meta.slots),
    slotClocks: meta.slots,
    stores,
  };

  const res = await api.write(doc);
  if (res.ok) setStatus({ lastSyncedAt: res.at ?? new Date().toISOString(), error: null });
  else setStatus({ error: res.error ?? 'Could not write to the sync folder.' });
}

function scheduleWrite() {
  if (applying || !config?.enabled) return;
  if (writeTimer) clearTimeout(writeTimer);
  // Long enough that typing a task title is one write rather than twenty — a
  // pause this long means you stopped typing — and short enough that the other
  // device has it before you've finished picking it up. Now that a write is
  // pushed rather than waited for, this delay *is* the latency between the two
  // screens, so it is worth keeping honest.
  writeTimer = setTimeout(() => { writeTimer = null; void publish(true); }, 700);
}

// ── Pull ──────────────────────────────────────────────────────────────────────

/** Of two peer documents, the one that supersedes the other *for one slot* — or,
 *  if neither does, the more recently written. */
function preferredForSlot(a: SyncDoc, b: SyncDoc, slot: Slot): SyncDoc {
  const rel = compareClocks(slotClock(a, slot), slotClock(b, slot));
  if (rel === 'ahead') return a;
  if (rel === 'behind') return b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

/** What this device should do about one slot, given the best peer for it. */
interface SlotPlan {
  slot: Slot;
  source: SyncDoc;
  relation: ClockRelation;
}

/**
 * Applies the slots we decided to take, in one pass, and folds their clocks into
 * ours. Everything else on this machine is left exactly as it is — that is the
 * whole point of tracking slots separately.
 */
async function adoptSlots(plans: SlotPlan[], conflicted: SlotPlan[]) {
  const api = bridge();

  if (conflicted.length && api) {
    // Some slot on this machine is about to be replaced by a version that isn't
    // a descendant of it, so park a restorable copy before it goes.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const res = await api.writeBackup(`${config?.deviceName ?? 'device'}-${stamp}.json`, backupBundle());
    const names = conflicted.map(p => SLOT_LABEL[p.slot]).join(' and ');
    const from = conflicted[0].source.deviceName;
    setStatus({
      notice: res.ok
        ? `Both computers had edited ${names} since the last sync, so “${from}” (the more recent) was used. This computer's version was saved to backups/ in the sync folder — restore it with Load backup if it was the one you wanted.`
        : `Both computers had edited ${names} since the last sync, so “${from}” (the more recent) was used. This computer's version could NOT be backed up: ${res.error}`,
    });
  }

  const incoming: Partial<Record<Slot, string>> = {};
  for (const plan of plans) {
    const raw = plan.source.stores[plan.slot];
    if (typeof raw === 'string') incoming[plan.slot] = raw;
  }
  applyStores(incoming);

  const meta = loadMeta();
  for (const plan of plans) {
    meta.slots[plan.slot] = mergeClocks(meta.slots[plan.slot], slotClock(plan.source, plan.slot));
  }
  saveMeta(meta);
  setStatus({ lastSyncedAt: new Date().toISOString(), error: null });

  // Record that we've seen it, so the next comparison is 'equal' rather than a
  // second conflict over the same divergence.
  await publish(false);
}

/** Human names for the notice text — "quests", not "quest". */
const SLOT_LABEL: Record<Slot, string> = {
  quest: 'quests and tasks',
  vynues: 'Vynues projects',
  ui: 'display settings',
};

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

  const meta = loadMeta();
  const take: SlotPlan[] = [];
  const conflicted: SlotPlan[] = [];
  let weAreAhead = false;

  // Each slot is decided on its own evidence: an edit to quests over there and
  // to Vynues over here means both sides fast-forward, with nothing discarded.
  for (const slot of SLOT_NAMES) {
    const source = peers.reduce((a, b) => preferredForSlot(a, b, slot));
    const relation = compareClocks(slotClock(source, slot), meta.slots[slot]);
    if (relation === 'ahead') take.push({ slot, source, relation });
    else if (relation === 'concurrent') { const plan = { slot, source, relation }; take.push(plan); conflicted.push(plan); }
    else if (relation === 'behind') weAreAhead = true;
  }

  if (take.length) await adoptSlots(take, conflicted);
  else if (weAreAhead) await publish(false);   // peers are out of date — re-state ours
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
  transport = await buildTransport();
  const browser = !window.electronAPI?.sync;
  // Said even when there is nothing to sync with, because a browser copy that is
  // working alone still needs the settings card to point it at a relay.
  setStatus({ overWifi: browser, linked: !!bridge() });

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
  // `focus` is the desktop's version of that moment. A phone returning from the
  // background often never fires it — the page was never unfocused, it was
  // suspended — so the one thing you always do before looking at your tasks
  // wouldn't refresh them. Both, because either can arrive without the other.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void pull(); });
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
  // Folder sync is a desktop arrangement: picking one on a phone would be
  // choosing a folder that phone cannot see.
  const api = window.electronAPI?.sync;
  if (!api) return;

  config = await api.setConfig({ enabled: true, folder });
  setStatus({ enabled: true, folder: config.folder, busy: true, error: null, notice: null });

  try {
    const res = await api.readPeers();
    const peers = (res.ok ? res.peers ?? [] : []) as SyncDoc[];

    if (mode === 'push') {
      // Absorb every peer's clock on every slot, then bump: the result strictly
      // supersedes all of them, so they fast-forward instead of seeing conflicts.
      const meta = loadMeta();
      for (const peer of peers) {
        for (const slot of SLOT_NAMES) meta.slots[slot] = mergeClocks(meta.slots[slot], slotClock(peer, slot));
      }
      // Force every slot to count as changed, so the bump below reaches all three
      // even where our content happens to match what we last published.
      meta.published = {};
      saveMeta(meta);
      await publish(true);
      if (peers.length) setStatus({ notice: 'This computer\'s data is now the shared copy. The other computer will pick it up next time it syncs.' });
    } else if (peers.length) {
      // Explicitly discarding this machine's data, so keep a rescue copy.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await api.writeBackup(`${config?.deviceName ?? 'device'}-before-adopt-${stamp}.json`, backupBundle());
      // Take every slot from the best peer for it — this is the deliberate
      // "replace what's here", so no slot is exempt.
      const plans = SLOT_NAMES.map(slot => ({
        slot,
        source: peers.reduce((a, b) => preferredForSlot(a, b, slot)),
        relation: 'ahead' as const,
      }));
      await adoptSlots(plans, []);
      const names = [...new Set(plans.map(p => p.source.deviceName))].join('” and “');
      setStatus({ notice: `Loaded the data from “${names}”. This computer's previous data was saved to backups/ in the sync folder.` });
    } else {
      await publish(true);
    }
    setStatus({ peers: peers.map(p => ({ deviceName: p.deviceName, updatedAt: p.updatedAt })) });
  } finally {
    setStatus({ busy: false });
  }
}

export async function disableSync() {
  const api = window.electronAPI?.sync;
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
  const api = window.electronAPI?.sync;
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
