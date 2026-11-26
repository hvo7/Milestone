/**
 * Keeps Milestone's copies on your devices in step — the desktop, the laptop and
 * the phone — through whichever routes each one has: a folder the cloud drive
 * carries (electron/cloudSync.cjs), the desktop's Wi-Fi server, and the relay.
 * The routes only move documents; this file decides what each device keeps.
 *
 * ── Whether a device is behind ──────────────────────────────────────────────
 * Each synced store ("slot") carries a vector clock — a count per device id,
 * bumped on a device's own entry when it publishes a change and merged when it
 * takes in someone else's. Wall-clock times can't answer whether one copy has
 * *seen* another; the clocks can.
 *
 * ── What each device keeps ──────────────────────────────────────────────────
 * Since 3.5 every item in a store is merged on its own (lib/syncMerge.ts): each
 * change carries a dot saying which device made it at which count, so for every
 * quest, task and habit sync knows whether the other side had already seen this
 * side's version. Only the item edited on both sides without either seeing the
 * other is a real conflict, and the daily reset never beats a change you made.
 *
 * Before 3.5 a conflict replaced a whole store with the most recently written
 * copy. A laptop opened after a few days runs its daily reset first, which made
 * its stale copy "the most recent" — so it overwrote everything the phone had
 * done in the meantime. That is the failure this design removes.
 *
 * ── Order of work ───────────────────────────────────────────────────────────
 * A device stamps its own changes, merges every other device's copy into its
 * own, applies the result, and only then publishes. It never publishes a copy it
 * has not reconciled with what it just read.
 *
 * ── Older builds ────────────────────────────────────────────────────────────
 * Documents from 3.4.1 and earlier carry no item stamps. They are merged
 * conservatively — nothing they lack is deleted unless they had demonstrably
 * seen it — and anything of yours they dropped is listed as a sync issue.
 */
import { create } from 'zustand';
import { QUEST_STORE_KEY, UI_STORE_KEY } from '../uiStore';
import { useQuestStore } from '../store';
import { useUIStore } from '../uiStore';
import { VYNUES_STORE_KEY, useVynuesStore } from '../vynuesStore';
import { APP_VERSION } from '../buildInfo';
import { withoutHistory, clearHistory } from './history';
import { httpBridge, compositeBridge, servedByMilestone, identity, rememberToken, type SyncBridge, type HistoryEntry } from './phoneTransport';
import { loadRelay, relayConfigured, provisionSharedRelay } from './relay';
import { applyVitalsSlot, parseVitalsSlot, readVitalsSlot, subscribeVitals, vitalsStorageEmpty } from './vitalsSync';
import { compareClocks, mergeClocks, type Clock, type ClockRelation } from './syncClock';
import {
  explode, implode, stage, mergeSides, pruneTombs, stampEverything, missingItems, withItems, entityLabel, isItemPath, normalize, baselineOf,
  differingItems, withVersions,
  type Dot, type Entities, type Side, type Stamps, type MergeConflict, type Baseline,
} from './syncMerge';
import { automaticMarks, clearAutomaticMarks } from './syncIntent';
import { SYNC_ISSUES_KEY, useSyncIssues, recordIssues, closeIssue, type SyncIssue, type NewIssue } from './syncIssues';
import { isSyncPaused, setSyncPausedFlag, saveSafetySnapshot } from './syncSafety';

export { compareClocks, mergeClocks };
export type { Clock, ClockRelation };

export type Slot = 'quest' | 'vynues' | 'ui' | 'vitals' | 'issues';
type Version = { at: string; deviceId: string };

export const SLOT_NAMES: Slot[] = ['quest', 'vynues', 'ui', 'vitals', 'issues'];
/** Item-stamped documents. Absent on documents from 3.4.1 and earlier. */
export const SYNC_PROTOCOL = 2;

export interface SyncDoc {
  _milestoneSync: 1;
  deviceId: string;
  deviceName: string;
  /** Informational, and the tiebreak between copies that predate item stamps. */
  updatedAt: string;
  /** The build that wrote this. Absent on documents from before 3.4.1. */
  appVersion?: string;
  /** Doc-level clock: the union of the slot clocks, for builds before slot clocks. */
  clock: Clock;
  slotClocks?: Partial<Record<Slot, Clock>>;
  slotVersions?: Partial<Record<Slot, Version>>;
  stores: Partial<Record<Slot, string>>;
  /** Per-slot item stamps (s) and deletions (t). Present from protocol 2. */
  items?: Partial<Record<Slot, { s: Record<string, Dot>; t: Record<string, Dot> }>>;
  syncProtocol?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validDot = (dot: unknown) => Array.isArray(dot) && dot.length === 4 && typeof dot[0] === 'string' && /^[\w-]{1,64}$/.test(dot[0])
  && Number.isSafeInteger(dot[1]) && dot[1] >= 0 && Number.isFinite(dot[2]) && (dot[3] === 0 || dot[3] === 1);

/** Reject corrupt payloads before touching persisted data or live store methods. */
export function isSyncDoc(value: unknown): value is SyncDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as SyncDoc;
  const validClock = (clock: Clock) => clock && typeof clock === 'object' && !Array.isArray(clock)
    && Object.entries(clock).every(([id, count]) => /^[\w-]{1,64}$/.test(id) && Number.isSafeInteger(count) && count >= 0);
  if (doc._milestoneSync !== 1 || typeof doc.deviceId !== 'string' || !/^[\w-]{1,64}$/.test(doc.deviceId)
    || typeof doc.deviceName !== 'string' || !Number.isFinite(Date.parse(doc.updatedAt)) || !validClock(doc.clock)
    || !doc.stores || typeof doc.stores !== 'object') return false;
  if (doc.items !== undefined && !isObject(doc.items)) return false;
  try {
    for (const slot of SLOT_NAMES) {
      if (doc.slotClocks?.[slot] && !validClock(doc.slotClocks[slot]!)) return false;
      const version = doc.slotVersions?.[slot];
      if (version && (!Number.isFinite(Date.parse(version.at)) || typeof version.deviceId !== 'string')) return false;
      const items = doc.items?.[slot];
      if (items !== undefined && (!isObject(items) || !isObject(items.s) || !isObject(items.t)
        || !Object.values(items.s).every(validDot) || !Object.values(items.t).every(validDot))) return false;
      const raw = doc.stores[slot];
      if (raw === undefined) continue;
      if (typeof raw !== 'string' || !validSlot(slot, raw)) return false;
    }
    return true;
  } catch { return false; }
}

/** A slot string this build can safely load into its stores. */
function validSlot(slot: Slot, raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.state || typeof parsed.state !== 'object' || Array.isArray(parsed.state)) return false;
    if (slot === 'vitals') return !!parseVitalsSlot(raw) || !('areas' in parsed.state);
    const store = SLOTS.find(item => item.slot === slot)!.store as unknown as { getState: () => Record<string, unknown> };
    const live = store.getState();
    if (Object.keys(parsed.state).some(key => ['__proto__', 'constructor', 'prototype'].includes(key) || typeof live[key] === 'function')) return false;
    if (slot === 'quest' && (!Array.isArray(parsed.state.questlines) || !Array.isArray(parsed.state.routines))) return false;
    if (slot === 'vynues' && !Array.isArray(parsed.state.projects)) return false;
    if (slot === 'issues' && !Array.isArray(parsed.state.issues)) return false;
    return true;
  } catch { return false; }
}

interface SyncConfig { enabled: boolean; folderEnabled?: boolean; folder: string; deviceId: string; deviceName: string; }

/** Minimal shape of a persisted zustand store. */
interface Settable { setState: (partial: object) => void }

const SLOTS: { slot: Exclude<Slot, 'vitals'>; key: string; store: Settable }[] = [
  { slot: 'quest',  key: QUEST_STORE_KEY,  store: useQuestStore  as unknown as Settable },
  { slot: 'vynues', key: VYNUES_STORE_KEY, store: useVynuesStore as unknown as Settable },
  { slot: 'ui',     key: UI_STORE_KEY,     store: useUIStore     as unknown as Settable },
  { slot: 'issues', key: SYNC_ISSUES_KEY,  store: useSyncIssues  as unknown as Settable },
];

/** Local sync bookkeeping. Deliberately *not* synced — it is what this device
 *  knows about the world. */
const META_KEY = 'milestone-sync-meta';

// ── Status, for the settings cards ────────────────────────────────────────────

export interface PeerStatus {
  deviceName: string;
  updatedAt: string;
  appVersion?: string;
  /** Written by a build before item-level merging (3.4.1 or older). */
  legacy?: boolean;
  /** Changes this device knows about that the peer's last copy had not seen. */
  waiting?: number;
}

export interface SyncStatus {
  /** Desktop build with the sync bridge — false in a browser tab. */
  available: boolean;
  enabled: boolean;
  folderEnabled: boolean;
  folder: string;
  deviceName: string;
  peers: PeerStatus[];
  lastSyncedAt: string | null;
  busy: boolean;
  error: string | null;
  /** Something the user should read once. */
  notice: string | null;
  /** A standing problem that is not stopping sync. Re-evaluated every exchange. */
  warning: string | null;
  /** True in a browser rather than the desktop app — a phone, or a tab. */
  overWifi: boolean;
  /** True when this copy has some route to its other copies. */
  linked: boolean;
  /** Sync stopped by hand from the recovery tools. Edits are kept and sent on resume. */
  paused: boolean;
  /** Changes made here that have not been delivered yet. */
  pending: boolean;
}

export const useSyncStatus = create<SyncStatus>(() => ({
  available: false, enabled: false, folderEnabled: false, folder: '', deviceName: '',
  peers: [], lastSyncedAt: null, busy: false, error: null, notice: null, warning: null, overWifi: false, linked: false,
  paused: false, pending: false,
}));

const setStatus = (patch: Partial<SyncStatus>) => useSyncStatus.setState(patch);
export const dismissNotice = () => setStatus({ notice: null });

// ── Clocks ────────────────────────────────────────────────────────────────────

/** A document's clock for one slot. Older documents have only the doc-level clock. */
export const slotClock = (doc: Pick<SyncDoc, 'clock' | 'slotClocks'>, slot: Slot): Clock =>
  doc.slotClocks?.[slot] ?? doc.clock ?? {};

/** The doc-level clock to publish alongside per-slot ones. */
export const unionClocks = (slots: Partial<Record<Slot, Clock>>): Clock =>
  SLOT_NAMES.reduce<Clock>((acc, slot) => mergeClocks(acc, slots[slot] ?? {}), {});

// ── Local state ───────────────────────────────────────────────────────────────

let config: SyncConfig | null = null;
/** Set while remote data is being written into the stores. */
let applying = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pullChain: Promise<void> = Promise.resolve();
let cleanup: (() => void) | null = null;
let pendingPull: Promise<void> | null = null;
let pullRequested = false;
let deliveredSnapshot = '';
/** The other devices' documents as last read, for the recovery tools. */
let lastPeers: SyncDoc[] = [];

function enqueue(work: () => Promise<void>) {
  pullChain = pullChain.then(work).catch(err => {
    setStatus({ error: err instanceof Error ? err.message : String(err) });
  });
  return pullChain;
}

let transport: SyncBridge | null = null;
const bridge = () => transport ?? (window.electronAPI?.sync as SyncBridge | undefined) ?? null;

/**
 * Every route this device has to its other copies, as one bridge: the cloud
 * folder and Wi-Fi server (desktop), the origin that served the page (phone),
 * and the relay. Reads take the union and writes go everywhere.
 */
async function buildTransport(): Promise<SyncBridge | null> {
  const parts: SyncBridge[] = [];
  const local = window.electronAPI?.sync as SyncBridge | undefined;
  if (local) parts.push(local);

  const savedRelay = loadRelay();
  const linkToken = local ? '' : rememberToken();
  // Pairing inside an iPhone Home Screen app writes the relay settings, not
  // Safari's URL token. Use that key for the same-origin route too.
  const originToken = savedRelay.url === location.origin && relayConfigured(savedRelay)
    ? savedRelay.token : linkToken;

  // A paired offline PWA must retain its route even when health is unreachable.
  if (!local && (originToken || await servedByMilestone())) {
    parts.push(httpBridge({ token: originToken, me: identity() }));
  }

  const desktopConfig = local ? await local.getConfig() : null;
  if (desktopConfig?.sharedRelay) provisionSharedRelay(desktopConfig.sharedRelay);
  const relay = loadRelay();
  const servedByRelay = !local && parts.length > 0 && relay.url === location.origin;
  if (relayConfigured(relay) && !servedByRelay) {
    parts.push(httpBridge({
      base: relay.url,
      token: relay.token,
      me: local ? await local.getConfig() : identity(),
      poll: !local,
    }));
  }

  if (!parts.length) return null;
  return parts.length === 1 && local ? null : compositeBridge(parts);
}

interface Meta {
  /** What this device has seen, per slot. */
  slots: Record<Slot, Clock>;
  /** Each slot as this device last stamped it, as path → fingerprint: the
   *  baseline its next local changes are measured against. */
  base: Partial<Record<Slot, Record<string, string>>>;
  /** Item stamps and deletions per slot. */
  items: Partial<Record<Slot, Stamps>>;
  /** A write still has to reach every route. Survives restart. */
  pending?: boolean;
  versions?: Partial<Record<Slot, Version>>;
  /** Set once this device has joined (or started) a sync group under item stamps. */
  protocol?: number;
}

const emptyMeta = (): Meta => ({ slots: { quest: {}, vynues: {}, ui: {}, vitals: {}, issues: {} }, base: {}, items: {} });

const toRecord = (baseline: Baseline) => Object.fromEntries(baseline);
const baselineFor = (meta: Meta, slot: Slot): Baseline => new Map(Object.entries(meta.base[slot] ?? {}));

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.slots) {
      const meta = emptyMeta();
      for (const slot of SLOT_NAMES) {
        if (parsed.slots[slot] && typeof parsed.slots[slot] === 'object') meta.slots[slot] = parsed.slots[slot] as Clock;
      }
      if (parsed.base && typeof parsed.base === 'object') meta.base = parsed.base;
      else if (parsed.published && typeof parsed.published === 'object') {
        // 3.4.1 kept a full copy of what it last published. Its fingerprints
        // are the baseline: whatever changed since is this device's news.
        for (const slot of SLOT_NAMES) {
          const raw = parsed.published[slot];
          const entities = typeof raw === 'string' ? explode(raw) : null;
          if (entities) meta.base[slot] = toRecord(baselineOf(entities));
        }
      }
      if (parsed.items && typeof parsed.items === 'object') meta.items = parsed.items;
      meta.pending = parsed.pending === true;
      meta.versions = parsed.versions ?? {};
      if (typeof parsed.protocol === 'number') meta.protocol = parsed.protocol;
      return meta;
    }
    // Upgrade from the single-clock format: that one clock described every slot.
    if (parsed && typeof parsed.clock === 'object' && parsed.clock) {
      const meta = emptyMeta();
      for (const slot of SLOT_NAMES) meta.slots[slot] = { ...parsed.clock as Clock };
      return meta;
    }
  } catch { /* corrupt meta is recoverable — start from an empty clock */ }
  return emptyMeta();
}

const saveMeta = (meta: Meta) => localStorage.setItem(META_KEY, JSON.stringify(meta));

/** Has this device ever synced: a first exchange joins a group rather than
 *  stamping whatever defaults a fresh install holds as news. Devices upgrading
 *  from 3.4.1 have published before and count as joined. */
const joined = (meta: Meta) => !!meta.protocol || Object.keys(meta.base).length > 0;

/** One slot as it sits on this device. `undefined` = nothing here; `null` =
 *  something here that can't be read, which must never count as "deleted". */
function readSlot(slot: Slot): string | undefined | null {
  if (slot === 'vitals') {
    const raw = readVitalsSlot();
    return raw !== undefined ? raw : vitalsStorageEmpty() ? undefined : null;
  }
  const key = SLOTS.find(item => item.slot === slot)!.key;
  return localStorage.getItem(key) ?? undefined;
}

function snapshot(): Partial<Record<Slot, string>> {
  const stores: Partial<Record<Slot, string>> = {};
  for (const slot of SLOT_NAMES) {
    const raw = readSlot(slot);
    if (typeof raw === 'string') stores[slot] = raw;
  }
  return stores;
}

/** A slot's entities, with absence as an empty set. Null when unreadable. */
function entitiesOf(raw: string | undefined | null): Entities | null {
  if (raw === null) return null;
  if (raw === undefined) return new Map();
  return cachedExplode(raw);
}

const exploded = new Map<string, Entities>();
function cachedExplode(raw: string): Entities | null {
  const hit = exploded.get(raw);
  if (hit) return hit;
  const result = explode(raw);
  if (result) {
    exploded.set(raw, result);
    if (exploded.size > 12) exploded.delete(exploded.keys().next().value!);
  }
  return result;
}

/** Writes incoming versions into localStorage *and* the live stores. */
function applyStores(stores: Partial<Record<Slot, string>>) {
  applying = true;
  // Adopting other data makes every undo step meaningless — they describe a
  // state this profile is no longer in.
  clearHistory();
  return withoutHistory(() => {
  try {
    for (const { slot, key, store } of SLOTS) {
      const raw = stores[slot];
      if (typeof raw !== 'string') continue;
      localStorage.setItem(key, raw);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.state === 'object' && parsed.state) store.setState(parsed.state);
      } catch { /* the raw value is still on disk for next launch */ }
    }
    if (typeof stores.vitals === 'string') applyVitalsSlot(stores.vitals);
    const theme = useUIStore.getState().theme;
    document.documentElement.setAttribute('data-theme', theme);
    window.dispatchEvent(new Event('milestone:refresh-day'));
  } finally {
    applying = false;
  }
  });
}

/** The current data in the Backup & Restore bundle format. */
const bundleOf = (stores: Partial<Record<Slot, string>>) =>
  ({ _milestone: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(), quest: stores.quest, vynues: stores.vynues, ui: stores.ui, vitals: stores.vitals });

/** A safety copy of this device's data (the issue list is not data). */
const safetyCopy = (reason: string, stores = snapshot()) => {
  const data: Partial<Record<Slot, string>> = { ...stores };
  delete data.issues;
  return saveSafetySnapshot(reason, data).catch(() => {});
};

// ── Stamping local changes ────────────────────────────────────────────────────

/**
 * Gives this device's changes since the last stamp their dots and makes the
 * current data the new baseline. Synchronous, so nothing can change in between.
 */
function stageAll(meta: Meta, now = Date.now()) {
  if (!config) return;
  const me = config.deviceId;
  for (const slot of SLOT_NAMES) {
    const raw = readSlot(slot);
    if (raw === null) continue;                              // unreadable: leave it alone
    const current = entitiesOf(raw)!;
    const prior = meta.items[slot] ?? { stamps: {}, tombs: {} };
    const published = meta.slots[slot][me] ?? 0;
    const staged = stage(baselineFor(meta, slot), current, prior, meta.slots[slot], me, now, automaticMarks(slot));
    if (staged.changed.length) {
      meta.items[slot] = { stamps: staged.stamps, tombs: pruneTombs(staged.tombs, now) };
      meta.slots[slot] = staged.clock;
      meta.versions = { ...meta.versions, [slot]: { at: new Date(now).toISOString(), deviceId: me } };
      clearAutomaticMarks(slot, staged.changed);
      meta.pending = true;
      if (raw === undefined) delete meta.base[slot];
      else meta.base[slot] = toRecord(baselineOf(current));
    }
    if (meta.protocol !== SYNC_PROTOCOL) guard(meta, slot, current, published, now);
  }
  meta.protocol = SYNC_PROTOCOL;
}

/**
 * The first stamp after upgrading from 3.4.1.
 *
 * Everything here was made by hand somewhere but carries no stamp. Each item is
 * given one at the count this device last published under the old build: a
 * device that has seen that publish treats it as old news, and one that has not
 * (a laptop away for days) learns that this version is newer than its own.
 * Because it marks a change made by hand, a device still on the old build — a
 * laptop reverting to its stale copy — cannot replace or delete it either.
 */
function guard(meta: Meta, slot: Slot, current: Entities, published: number, now: number) {
  const items = meta.items[slot] ?? { stamps: {}, tombs: {} };
  const stamps = { ...items.stamps };
  for (const path of current.keys()) stamps[path] ??= [config!.deviceId, published, now, 0];
  meta.items[slot] = { ...items, stamps };
}

/** The document this device publishes: exactly what it last stamped. */
function buildDoc(meta: Meta): SyncDoc {
  const stores: Partial<Record<Slot, string>> = {};
  const items: NonNullable<SyncDoc['items']> = {};
  for (const slot of SLOT_NAMES) {
    // Read straight after stamping, with nothing awaited in between, so the
    // data and its stamps describe the same moment. An empty Life Vitals list
    // is never published: an older build could adopt "no areas" from it.
    const raw = readSlot(slot);
    if (typeof raw === 'string') stores[slot] = raw;
    const stamps = meta.items[slot];
    if (stamps) items[slot] = { s: stamps.stamps, t: stamps.tombs };
  }
  return {
    _milestoneSync: 1,
    deviceId: config!.deviceId,
    deviceName: config!.deviceName,
    updatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    syncProtocol: SYNC_PROTOCOL,
    clock: unionClocks(meta.slots),
    slotClocks: meta.slots,
    slotVersions: meta.versions,
    stores,
    items,
  };
}

// ── Publish ───────────────────────────────────────────────────────────────────

/** Stamps any local changes and writes this device's document everywhere. */
async function publish() {
  const api = bridge();
  if (!api || !config?.enabled || isSyncPaused()) return;

  const meta = loadMeta();
  // A device that has not joined its group yet waits for its first successful
  // read, so a fresh install's defaults are never published as news.
  if (!joined(meta)) return;
  stageAll(meta);
  saveMeta(meta);

  const doc = buildDoc(meta);
  const signature = JSON.stringify({ stores: doc.stores, slots: doc.slotClocks, items: doc.items, app: APP_VERSION });
  if (!meta.pending && signature === deliveredSnapshot) return;
  meta.pending = true;
  saveMeta(meta);
  setStatus({ pending: true });

  let res = await api.write(doc);
  // The relay refuses a document whose clock is behind the one it holds for
  // this device (a restored profile, cleared site data). Take back the clock
  // the relay remembers and send again.
  if (!res.ok && res.stale && api.readSelf) {
    const mine = await api.readSelf().catch(() => null);
    if (mine && isSyncDoc(mine) && mine.deviceId === config.deviceId) {
      const repaired = loadMeta();
      for (const slot of SLOT_NAMES) repaired.slots[slot] = mergeClocks(repaired.slots[slot], slotClock(mine, slot));
      saveMeta(repaired);
      doc.clock = unionClocks(repaired.slots);
      doc.slotClocks = repaired.slots;
      res = await api.write(doc);
      if (res.ok) setStatus({ notice: 'This device\'s sync record was behind the relay\'s copy and has been repaired. Syncing has resumed.' });
    }
  }
  if (res.ok) {
    deliveredSnapshot = signature;
    const done = loadMeta();
    // Anything stamped while the write was in flight is still owed.
    done.pending = JSON.stringify(done.base) !== JSON.stringify(meta.base);
    saveMeta(done);
    setStatus({ lastSyncedAt: res.at ?? new Date().toISOString(), error: null, pending: done.pending });
  }
  else setStatus({ error: res.error ?? 'Could not write to the sync folder.' });
  refreshPeerStatus();
}

function scheduleWrite() {
  if (applying || !config?.enabled) return;
  if (writeTimer) clearTimeout(writeTimer);
  // Long enough that typing a title is one write rather than twenty; short
  // enough that the other screen has it before you've picked it up.
  writeTimer = setTimeout(() => { writeTimer = null; void enqueue(publish); }, 700);
}

// ── Merge ─────────────────────────────────────────────────────────────────────

/** Of two peer documents, the one that supersedes the other for one slot — or,
 *  if neither does, the more recently written. Kept for copies without stamps. */
export function preferredForSlot(a: SyncDoc, b: SyncDoc, slot: Slot): SyncDoc {
  const rel = compareClocks(slotClock(a, slot), slotClock(b, slot));
  if (rel === 'ahead') return a;
  if (rel === 'behind') return b;
  const av = a.slotVersions?.[slot] ?? { at: a.updatedAt, deviceId: a.deviceId };
  const bv = b.slotVersions?.[slot] ?? { at: b.updatedAt, deviceId: b.deviceId };
  return av.at > bv.at || (av.at === bv.at && av.deviceId >= bv.deviceId) ? a : b;
}

/** Human names for messages. */
const SLOT_LABEL: Record<Slot, string> = {
  vitals: 'Life Vitals',
  quest: 'quests and tasks',
  vynues: 'Vynues projects',
  ui: 'display settings',
  issues: 'sync issues',
};

/** Does this document carry the slot at all. An older build that has never
 *  held a slot says nothing about it — its silence is not a deletion. */
const carries = (doc: SyncDoc, slot: Slot) => typeof doc.stores[slot] === 'string' || (!!doc.items && !!doc.items[slot]);

function remoteSide(doc: SyncDoc, slot: Slot): Side | null {
  const entities = entitiesOf(doc.stores[slot]);
  if (!entities) return null;
  const items = doc.items?.[slot];
  return {
    entities, stamps: items?.s ?? {}, tombs: items?.t ?? {}, clock: slotClock(doc, slot), legacy: !doc.items,
    device: { id: doc.deviceId, name: doc.deviceName }, at: doc.slotVersions?.[slot]?.at ?? doc.updatedAt,
  };
}

function localSide(meta: Meta, slot: Slot, entities: Entities): Side {
  return {
    entities, stamps: meta.items[slot]?.stamps ?? {}, tombs: meta.items[slot]?.tombs ?? {}, clock: meta.slots[slot], legacy: false,
    device: { id: config!.deviceId, name: config!.deviceName }, at: meta.versions?.[slot]?.at ?? '1970-01-01T00:00:00.000Z',
  };
}

/** Conflicts worth your attention: named items whose version gave way. */
function issuesFrom(slot: Slot, conflicts: MergeConflict[], entities: Entities, sides: Entities[]): NewIssue[] {
  if (slot === 'issues') return [];
  const out: NewIssue[] = [];
  for (const conflict of conflicts) {
    const label = entityLabel(conflict.kept.value) ?? entityLabel(conflict.lost.value);
    if (!label) continue;
    const where = entities.get(conflict.path) ?? sides.map(side => side.get(conflict.path)).find(Boolean);
    out.push({
      kind: conflict.kind, slot, path: conflict.path, label,
      keptFrom: conflict.kept.device, lostFrom: conflict.lost.device, lost: conflict.lost.value,
      parent: where?.parent ?? null, field: where?.field ?? null,
    });
  }
  return out;
}

/**
 * Brings every other device's changes into this one, item by item.
 *
 * Returns what moved. Runs synchronously from reading the local stores to
 * writing the result, so an edit can't slip in between and be overwritten.
 */
function mergePeers(meta: Meta, peers: SyncDoc[]): { stores: Partial<Record<Slot, string>>; issues: NewIssue[]; from: Set<string>; invalid: Slot[] } {
  const out: Partial<Record<Slot, string>> = {};
  const issues: NewIssue[] = [];
  const from = new Set<string>();
  const invalid: Slot[] = [];

  for (const slot of SLOT_NAMES) {
    const remotes = peers.filter(peer => carries(peer, slot));
    if (!remotes.length) continue;
    const current = entitiesOf(readSlot(slot));
    if (!current) continue;
    const base = baselineFor(meta, slot);
    let side = localSide(meta, slot, current);
    let changed = false;
    const found: MergeConflict[] = [];
    const sides: Entities[] = [];

    for (const peer of remotes) {
      const remote = remoteSide(peer, slot);
      if (!remote) continue;
      const relation = compareClocks(remote.clock, side.clock);
      // Nothing it holds is news here.
      if (relation === 'behind' || relation === 'equal') continue;
      const merged = mergeSides(side, remote, base);
      if (merged.changed) { changed = true; from.add(peer.deviceName); }
      found.push(...merged.conflicts);
      sides.push(remote.entities);
      side = { ...side, entities: merged.entities, stamps: merged.stamps, tombs: merged.tombs, clock: merged.clock };
    }

    const raw = changed ? implode(side.entities) : undefined;
    if (raw !== undefined && !validSlot(slot, raw)) { invalid.push(slot); continue; }
    meta.slots[slot] = side.clock;
    meta.items[slot] = { stamps: side.stamps, tombs: side.tombs };
    if (raw !== undefined) {
      out[slot] = raw;
      meta.base[slot] = toRecord(baselineOf(side.entities));
    }
    issues.push(...issuesFrom(slot, found, side.entities, [current, ...sides]));
  }
  return { stores: out, issues, from, invalid };
}

/**
 * A device's first exchange. With other devices already syncing, it takes their
 * data and keeps only its own items they have never had (and never deleted).
 * With none, its data starts the group and is stamped as this device's.
 */
function join(meta: Meta, peers: SyncDoc[], now = Date.now()): Partial<Record<Slot, string>> {
  const me = config!.deviceId;
  const out: Partial<Record<Slot, string>> = {};
  for (const slot of SLOT_NAMES) {
    const raw = readSlot(slot);
    if (raw === null) continue;
    const local = entitiesOf(raw)!;
    const remotes = peers.filter(peer => carries(peer, slot)).map(peer => remoteSide(peer, slot)).filter((side): side is Side => !!side);
    if (!remotes.length) {
      const staged = stage(new Map(), local, { stamps: {}, tombs: {} }, meta.slots[slot], me, now);
      meta.items[slot] = { stamps: staged.stamps, tombs: staged.tombs };
      meta.slots[slot] = staged.clock;
      if (raw !== undefined) meta.base[slot] = toRecord(baselineOf(local));
      continue;
    }
    const group = remotes.slice(1).reduce<Side>((acc, remote) => {
      const merged = mergeSides(acc, remote);
      return { ...acc, entities: merged.entities, stamps: merged.stamps, tombs: merged.tombs, clock: merged.clock };
    }, remotes[0]);
    const theirs = group.entities;
    const mine = missingItems(theirs, local).map(item => item.path).filter(path => !group.tombs[path]);
    const result = mine.length ? withItems(theirs, local, mine) : theirs;
    const resultRaw = implode(result);
    if (!validSlot(slot, resultRaw)) continue;
    meta.items[slot] = { stamps: group.stamps, tombs: group.tombs };
    meta.slots[slot] = mergeClocks(meta.slots[slot], group.clock);
    // The group's copy is the baseline, so this device's own items become its
    // first stamped changes and travel to the others.
    meta.base[slot] = toRecord(baselineOf(theirs));
    if (resultRaw !== raw) out[slot] = resultRaw;
  }
  meta.protocol = SYNC_PROTOCOL;
  return out;
}

async function pullOnce() {
  const api = bridge();
  if (!api || !config?.enabled) return;
  if (isSyncPaused()) { setStatus({ paused: true }); return; }

  const res = await api.readPeers();
  if (!res.ok) { setStatus({ error: res.error ?? 'Could not read the sync folder.' }); return; }
  if (!Array.isArray(res.peers)) {
    setStatus({ error: 'The sync route returned an unreadable answer. Local data was kept.' });
    return;
  }
  if (isSyncPaused()) return;
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }

  // One unreadable document must not stop this device syncing with the others.
  const unreadable = res.peers.filter(doc => !isSyncDoc(doc)) as { deviceName?: unknown }[];
  const peers = res.peers.filter(isSyncDoc).filter(doc => doc.deviceId !== config?.deviceId);
  lastPeers = peers;
  const skipped = unreadable.map(doc => typeof doc?.deviceName === 'string' && doc.deviceName ? doc.deviceName.slice(0, 40) : 'an unnamed device');
  setStatus({
    warning: skipped.length
      ? `Skipped unreadable sync data from ${[...new Set(skipped)].join(', ')}. Update Milestone on that device; the other devices are still syncing.`
      : null,
  });

  // From here to applyStores nothing awaits: what is read is what is merged.
  const meta = loadMeta();
  const before = snapshot();
  let incoming: Partial<Record<Slot, string>>;
  let issues: NewIssue[] = [];
  let from: Set<string>;
  if (!joined(meta)) {
    incoming = join(meta, peers);
    from = new Set(peers.map(peer => peer.deviceName));
  } else {
    stageAll(meta);
    const merged = mergePeers(meta, peers);
    incoming = merged.stores;
    issues = merged.issues;
    from = merged.from;
    if (merged.invalid.length) {
      setStatus({ warning: `Could not combine ${merged.invalid.map(slot => SLOT_LABEL[slot]).join(' and ')} with another device's copy. This device's version was kept.` });
    }
  }

  const moved = Object.keys(incoming).length > 0;
  if (moved) {
    applyStores(incoming);
    meta.pending = true;
  }
  saveMeta(meta);
  if (moved) void safetyCopy(`Before taking changes from ${[...from].join(', ') || 'another device'}`, before);
  if (recordIssues(issues)) {
    const open = useSyncIssues.getState().issues.filter(issue => issue.status === 'open').length;
    setStatus({ notice: `${open === 1 ? 'An item was' : `${open} items were`} changed on two devices at once. Both versions are kept in Sync health.` });
  }
  setStatus({ lastSyncedAt: new Date().toISOString(), error: null });
  refreshPeerStatus();

  await publish();
}

/** What each other device has and hasn't caught up on, for the status cards. */
function refreshPeerStatus() {
  const meta = loadMeta();
  const seen = (clock: Clock, dot: Dot) => (clock[dot[0]] ?? 0) >= dot[1];
  setStatus({
    pending: !!meta.pending,
    peers: lastPeers.map(peer => {
      let waiting = 0;
      for (const slot of SLOT_NAMES) {
        if (slot === 'issues') continue;
        const clock = slotClock(peer, slot);
        const items = meta.items[slot];
        for (const [path, dot] of [...Object.entries(items?.stamps ?? {}), ...Object.entries(items?.tombs ?? {})]) {
          if (isItemPath(path) && !seen(clock, dot)) waiting++;
        }
      }
      return { deviceName: peer.deviceName, updatedAt: peer.updatedAt, appVersion: peer.appVersion, legacy: !peer.items, waiting };
    }),
  });
}

/** Serialised so a burst of watcher events can't run two reconciliations at once. */
function pull() {
  pullRequested = true;
  if (!pendingPull) pendingPull = enqueue(async () => {
    do { pullRequested = false; await pullOnce(); } while (pullRequested);
  }).finally(() => { pendingPull = null; });
  return pendingPull;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function connect() {
  deliveredSnapshot = '';
  cleanup?.();
  cleanup = null;
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  transport = await buildTransport();
  const browser = !window.electronAPI?.sync;
  setStatus({ overWifi: browser, linked: !!bridge(), paused: isSyncPaused() });

  const api = bridge();
  if (!api) { config = null; setStatus({ available: false, enabled: false, peers: [] }); return; }

  config = await api.getConfig();
  setStatus({
    available: true,
    enabled: config.enabled,
    folderEnabled: config.folderEnabled ?? (!!config.folder && config.enabled),
    folder: config.folder,
    deviceName: config.deviceName,
  });

  const offs = SLOTS.map(({ store }) =>
    (store as unknown as { subscribe: (fn: () => void) => () => void }).subscribe(scheduleWrite));
  offs.push(subscribeVitals(scheduleWrite));
  offs.push(api.onChanged(() => { void pull(); }));

  // Belt and braces around the watcher: coming back to a device you left open is
  // exactly when you most expect it to have caught up.
  const refresh = () => { void pull(); };
  const visible = () => { if (!document.hidden) refresh(); };
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', visible);
  const timer = setInterval(refresh, 300_000);
  cleanup = () => {
    offs.forEach(off => off());
    window.removeEventListener('focus', refresh);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', visible);
    clearInterval(timer);
  };

  if (config.enabled) {
    const meta = loadMeta(); meta.pending = true; saveMeta(meta);
    void safetyCopy('When Milestone opened');
    await pullOnce();
  }
}

/** Reconnect is serialized with writes, so old routes never apply after switching. */
export function startCloudSync() { return enqueue(connect); }
export const reconnectCloudSync = startCloudSync;

export async function stopCloudSync() {
  await enqueue(async () => {
    cleanup?.(); cleanup = null;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null; config = null; transport = null;
  });
}

/**
 * Turns folder sync on. `mode` settles the one moment where a choice is
 * needed — the folder already holds another computer's data:
 *   'adopt' — take what's in the folder, replacing this computer's data
 *   'push'  — make this computer's data the shared copy
 */
async function enableFolder(folder: string, mode: 'adopt' | 'push') {
  const api = window.electronAPI?.sync;
  if (!api) return;

  config = await api.setConfig({ enabled: true, folder });
  setStatus({ enabled: true, folderEnabled: true, folder: config.folder, busy: true, error: null, notice: null });

  try {
    const res = await api.readPeers();
    if (!res.ok) throw new Error(res.error ?? 'Unable to inspect existing sync data.');
    const peers = (res.peers ?? []).filter(isSyncDoc).filter(doc => doc.deviceId !== config?.deviceId);
    lastPeers = peers;
    await safetyCopy(mode === 'push' ? 'Before sharing this computer\'s data' : 'Before loading the folder\'s data');

    if (mode === 'push' || !peers.length) {
      makeAuthoritative(peers);
      await publish();
      if (peers.length) setStatus({ notice: 'This computer\'s data is now the shared copy. The other devices will pick it up next time they sync.' });
    } else {
      const backup = await api.writeBackup(`${config?.deviceName ?? 'device'}-before-adopt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, bundleOf(snapshot()));
      if (!backup.ok) throw new Error('Could not back up local data; adoption cancelled.');
      const meta = loadMeta();
      // Replace, not merge: this is the explicit "use the folder's data".
      meta.base = {}; meta.items = {}; meta.protocol = undefined;
      for (const slot of SLOT_NAMES) meta.slots[slot] = {};
      const incoming = adoptGroup(meta, peers);
      applyStores(incoming);
      saveMeta(meta);
      await publish();
      const names = [...new Set(peers.map(p => p.deviceName))].join('” and “');
      setStatus({ notice: `Loaded the data from “${names}”. This computer's previous data was saved to backups/ in the sync folder.` });
    }
    refreshPeerStatus();
  } finally {
    setStatus({ busy: false });
  }
}

/** The group's data, replacing this device's outright. */
function adoptGroup(meta: Meta, peers: SyncDoc[]): Partial<Record<Slot, string>> {
  const out: Partial<Record<Slot, string>> = {};
  for (const slot of SLOT_NAMES) {
    const remotes = peers.filter(peer => carries(peer, slot)).map(peer => remoteSide(peer, slot)).filter((side): side is Side => !!side);
    if (!remotes.length) continue;
    const group = remotes.slice(1).reduce<Side>((acc, remote) => {
      const merged = mergeSides(acc, remote);
      return { ...acc, entities: merged.entities, stamps: merged.stamps, tombs: merged.tombs, clock: merged.clock };
    }, remotes[0]);
    const raw = implode(group.entities);
    if (!validSlot(slot, raw)) continue;
    meta.items[slot] = { stamps: group.stamps, tombs: group.tombs };
    meta.slots[slot] = group.clock;
    meta.base[slot] = toRecord(baselineOf(group.entities));
    out[slot] = raw;
  }
  meta.protocol = SYNC_PROTOCOL;
  meta.pending = true;
  return out;
}

/** Stamps every item here as newer than anything the given devices have seen,
 *  and marks whatever they hold that is not here as deleted. */
function makeAuthoritative(peers: SyncDoc[]) {
  const meta = loadMeta();
  const now = Date.now();
  const me = config!.deviceId;
  for (const slot of SLOT_NAMES) {
    const raw = readSlot(slot);
    if (raw === null) continue;
    const current = entitiesOf(raw)!;
    let clock = meta.slots[slot];
    const known = new Set<string>(Object.keys(meta.items[slot]?.tombs ?? {}));
    for (const peer of peers) {
      clock = mergeClocks(clock, slotClock(peer, slot));
      for (const path of entitiesOf(peer.stores[slot])?.keys() ?? []) known.add(path);
      for (const path of Object.keys(peer.items?.[slot]?.s ?? {})) known.add(path);
    }
    const staged = stampEverything(current, known, clock, me, now);
    meta.items[slot] = { stamps: staged.stamps, tombs: staged.tombs };
    meta.slots[slot] = staged.clock;
    meta.versions = { ...meta.versions, [slot]: { at: new Date(now).toISOString(), deviceId: me } };
    if (raw === undefined) delete meta.base[slot];
    else meta.base[slot] = toRecord(baselineOf(current));
  }
  meta.protocol = SYNC_PROTOCOL;
  meta.pending = true;
  saveMeta(meta);
  deliveredSnapshot = '';
}

export function enableSync(folder: string, mode: 'adopt' | 'push') {
  return enqueue(() => enableFolder(folder, mode)).then(reconnectCloudSync);
}

export async function disableSync() {
  const api = window.electronAPI?.sync;
  if (!api) return;
  await enqueue(async () => { await api.setConfig({ enabled: false }); });
  await reconnectCloudSync();
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
  const res = await api.readPeers(folder);
  if (!res.ok) throw new Error(res.error ?? 'Unable to inspect sync folder.');
  return (res.peers ?? []).filter(isSyncDoc).map(p => ({ deviceName: p.deviceName, updatedAt: p.updatedAt }));
}

/**
 * Announces a write that bypassed the stores — importing a backup replaces
 * localStorage wholesale. Stamping it makes the import this device's newest
 * change, so it travels rather than being undone.
 */
export function noteExternalWrite() {
  if (!config?.enabled) return;
  void enqueue(publish);
}

// ── Recovery: the emergency tools ─────────────────────────────────────────────

/** Stops exchanging with other devices. Edits keep saving here and are stamped,
 *  so resuming sends them without anything being overwritten. */
export async function setSyncPaused(paused: boolean) {
  setSyncPausedFlag(paused);
  setStatus({ paused });
  if (!paused) await syncNow();
}

/** A copy that recovery can compare against: another device's latest, a
 *  safety snapshot, or a relay history entry. */
export interface RecoverySource {
  id: string;
  label: string;
  at: string;
  stores: Partial<Record<Slot, string>>;
}

/** The other devices' current copies, as last read. */
export function peerCopies(): RecoverySource[] {
  return lastPeers.map(peer => ({ id: `peer:${peer.deviceId}`, label: `${peer.deviceName}'s copy`, at: peer.updatedAt, stores: peer.stores }));
}

/** Relay history, where the relay keeps it (1.1 relays and later). */
export async function relayHistory(): Promise<HistoryEntry[]> {
  const api = bridge();
  if (!api?.readHistory) return [];
  return api.readHistory().catch(() => []);
}

export async function relayHistoryCopy(id: string): Promise<RecoverySource | null> {
  const api = bridge();
  const doc = await api?.readHistoryItem?.(id).catch(() => null);
  if (!doc || !isSyncDoc(doc)) return null;
  return { id: `history:${id}`, label: `${doc.deviceName}'s copy`, at: doc.updatedAt, stores: doc.stores };
}

export interface RecoveryItem {
  slot: Slot; path: string; label: string;
  /** missing: not on this device. different: here, in another version. */
  change: 'missing' | 'different';
}

/** How `source` differs from this device, item by item. */
export function compareWith(source: RecoverySource): RecoveryItem[] {
  const out: RecoveryItem[] = [];
  for (const slot of SLOT_NAMES) {
    if (slot === 'issues' || source.stores[slot] === undefined) continue;
    const theirs = entitiesOf(source.stores[slot]);
    const mine = entitiesOf(readSlot(slot));
    if (!theirs || !mine) continue;
    for (const item of missingItems(mine, theirs)) out.push({ slot, ...item, change: 'missing' });
    for (const item of differingItems(mine, theirs)) out.push({ slot, ...item, change: 'different' });
  }
  return out;
}

/** Items in `source` that are not on this device. */
export const missingFrom = (source: RecoverySource) => compareWith(source).filter(item => item.change === 'missing');

/** Applies a local change made by a recovery action and sends it. The change
 *  is stamped as yours, so it reaches every device. */
async function applyRecovery(reason: string, stores: Partial<Record<Slot, string>>) {
  await enqueue(async () => {
    await safetyCopy(reason);
    applyStores(stores);
    if (config?.enabled) await publish();
  });
}

/** Puts back the chosen items: missing ones are added with their contents,
 *  different ones get that copy's version of their own fields. Nothing else
 *  here is removed or changed. */
export async function bringBack(source: RecoverySource, items: RecoveryItem[]): Promise<number> {
  const stores: Partial<Record<Slot, string>> = {};
  for (const slot of SLOT_NAMES) {
    const chosen = items.filter(item => item.slot === slot);
    if (!chosen.length) continue;
    const theirs = entitiesOf(source.stores[slot]);
    const mine = entitiesOf(readSlot(slot));
    if (!theirs || !mine) continue;
    const added = withItems(mine, theirs, chosen.filter(item => item.change === 'missing').map(item => item.path));
    const raw = implode(withVersions(added, theirs, chosen.filter(item => item.change === 'different').map(item => item.path)));
    if (validSlot(slot, raw)) stores[slot] = raw;
  }
  if (!Object.keys(stores).length) return 0;
  await applyRecovery(`Before bringing back items from ${source.label}`, stores);
  return items.length;
}

/** Replaces this device's data with `source` and sends it as the newest change,
 *  deletions included. */
export async function restoreCopy(source: RecoverySource): Promise<void> {
  const stores: Partial<Record<Slot, string>> = {};
  for (const slot of SLOT_NAMES) {
    const raw = source.stores[slot];
    if (slot !== 'issues' && typeof raw === 'string' && validSlot(slot, raw)) stores[slot] = raw;
  }
  await applyRecovery(`Before restoring ${source.label}`, stores);
}

/** Makes this device's data what every device holds. */
export async function shareThisDeviceEverywhere(): Promise<void> {
  await enqueue(async () => {
    const api = bridge();
    if (!api || !config?.enabled) throw new Error('Sync is not set up on this device.');
    const res = await api.readPeers();
    if (!res.ok) throw new Error(res.error ?? 'Could not reach the other devices.');
    const peers = (res.peers ?? []).filter(isSyncDoc).filter(doc => doc.deviceId !== config?.deviceId);
    lastPeers = peers;
    await safetyCopy('Before using this device\'s data everywhere');
    makeAuthoritative(peers);
    await publish();
    setStatus({ notice: 'This device\'s data is now the shared copy. Other devices take it on their next sync.' });
  });
}

const stampsOf = (slot: Slot) => loadMeta().items[slot]?.stamps ?? {};

/** Undoes what a sync issue set aside: the losing version comes back as your
 *  newest change. */
export async function restoreIssue(issue: SyncIssue): Promise<boolean> {
  const slot = issue.slot as Slot;
  if (!SLOT_NAMES.includes(slot) || slot === 'issues') return false;
  const mine = entitiesOf(readSlot(slot));
  if (!mine) return false;
  const next: Entities = new Map(mine);
  if (issue.lost === null) {
    // What gave way was a deletion: removing the item now carries it out.
    for (const path of [...next.keys()]) if (path === issue.path || path.startsWith(`${issue.path}/`)) next.delete(path);
  } else {
    const existing = next.get(issue.path);
    if (!existing && issue.parent && !next.has(issue.parent)) return false;
    next.set(issue.path, existing ? { ...existing, value: issue.lost } : { parent: issue.parent, field: issue.field, kind: 'item', value: issue.lost });
  }
  const raw = implode(normalize(next, stampsOf(slot)));
  if (!validSlot(slot, raw)) return false;
  await applyRecovery(`Before restoring “${issue.label}”`, { [slot]: raw });
  closeIssue(issue.id, 'restored');
  return true;
}

export const dismissIssue = (issue: SyncIssue) => closeIssue(issue.id, 'dismissed');

/** Every copy this device can see, in one file: its own, the other devices',
 *  and the open issues. For when something has gone wrong and needs a human. */
export function emergencyBundle() {
  return {
    _milestoneEmergency: 1,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    device: config ? { id: config.deviceId, name: config.deviceName } : null,
    thisDevice: bundleOf(snapshot()),
    otherDevices: lastPeers.map(peer => ({ deviceName: peer.deviceName, updatedAt: peer.updatedAt, appVersion: peer.appVersion, bundle: bundleOf(peer.stores) })),
    issues: useSyncIssues.getState().issues,
  };
}

export { bundleOf as backupBundleOf };
