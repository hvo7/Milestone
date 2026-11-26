/**
 * Item-level merging for sync.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Until 3.4.1 a conflict was settled for a whole store at once: when two devices
 * had both changed quests, the copy written most recently replaced the other in
 * full. A laptop opened after a few days runs its daily reset first, so its copy
 * was always the "most recent" one — and every quest, task and check-off made on
 * the phone in the meantime was thrown away and then synced back over the phone.
 *
 * Here each item (a questline, a quest, an action, a habit, a subtask, a Vynues
 * task, one day of the heatmap…) is merged on its own, and each side's change to
 * an item is judged by whether the *other side had seen it*:
 *
 *   • only one side changed it since the other last saw it → that side's version
 *   • both changed it without seeing each other            → a genuine conflict:
 *       a change you made beats an automatic one (the daily reset), and between
 *       two of yours the later one wins — the other is kept as a sync issue you
 *       can restore with one tap
 *   • one side deleted it while the other edited it        → it is kept
 *
 * ── Dots ────────────────────────────────────────────────────────────────────
 * Every change is stamped with a *dot*: the device that made it and that
 * device's counter in the slot's vector clock when it was published. "Has the
 * other side seen this change" is then exactly `otherClock[device] >= counter`.
 * Deletions leave a tombstone carrying the same kind of dot, so a missing item
 * means "deleted over there" rather than "never arrived" — the guess the old
 * whole-store design could not make.
 *
 * The stores themselves are untouched: items are found generically (arrays of
 * objects with ids, nested to any depth) and the stamps live beside the data in
 * the sync document and in this device's sync bookkeeping.
 */
import { compareClocks, mergeClocks, type Clock } from './syncClock';

/** [device, counter, time (ms), automatic (1) or yours (0)] */
export type Dot = [string, number, number, 0 | 1];

export interface Entity {
  /** The entity this one belongs to: a list or map container, or the item whose
   *  field holds it. Null for top-level values. */
  parent: string | null;
  /** The owner's field holding this item, for items nested inside an item. */
  field: string | null;
  kind: 'value' | 'list' | 'map' | 'entry' | 'item' | 'envelope';
  /** Canonical JSON of the entity's own value. For an item, nested item lists
   *  are replaced by `{ "$ids": [...] }` and carried as entities of their own. */
  value: string;
}

export type Entities = Map<string, Entity>;

/** What a device last stamped, as path → fingerprint of the value. Enough to
 *  tell what changed since, at a fraction of the size of a second copy. */
export type Baseline = Map<string, string>;

/** A 53-bit fingerprint of a value (two 32-bit FNV-1a passes, base 36). */
export function fingerprint(value: string): string {
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(36)}.${((b >>> 0) & 0x1fffff).toString(36)}.${value.length.toString(36)}`;
}

export function baselineOf(entities: Entities): Baseline {
  const out: Baseline = new Map();
  for (const [path, entity] of entities) out.set(path, fingerprint(entity.value));
  return out;
}

/** Top-level objects merged key by key rather than as one value. Each is a log
 *  keyed by day or by task, where two devices commonly add different keys. */
const MAP_KEYS = new Set(['completionLog', 'taskHistory', 'todoOrder']);
const ENVELOPE = '#version';

/** A path naming an item or a deletion you would recognise — not a list's
 *  order, a heatmap day or a setting. For counting what is waiting to sync. */
export const isItemPath = (path: string) => {
  const segments = path.split('/');
  return segments.length >= 3 && !MAP_KEYS.has(unesc(segments[1]));
};

// ── Canonical JSON ────────────────────────────────────────────────────────────

/** JSON with object keys sorted, so the same value always compares equal no
 *  matter which device (or which spread order) produced it. */
export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : canonical(item)).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const esc = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');
const unesc = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');
export const lastSegment = (path: string) => unesc(path.slice(path.lastIndexOf('/') + 1));

/** An array of objects that each carry a distinct string id. */
function isItemList(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

const isMarker = (value: unknown): value is { $ids: string[] } =>
  isObject(value) && Array.isArray(value.$ids) && Object.keys(value).length === 1;

// ── Explode / implode ─────────────────────────────────────────────────────────

/** A slot's `{ state, version }` string as a flat map of entities. Null when the
 *  string is not a readable slot. */
export function explode(raw: string | undefined | null): Entities | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isObject(parsed) || !isObject(parsed.state)) return null;
  const out: Entities = new Map();
  out.set(ENVELOPE, { parent: null, field: null, kind: 'envelope', value: canonical(parsed.version ?? null) });

  const addItem = (owner: string, field: string | null, item: Record<string, unknown>) => {
    const path = `${owner}/${field === null ? '' : `${esc(field)}/`}${esc(item.id as string)}`;
    const own: Record<string, unknown> = {};
    const nested: [string, Record<string, unknown>[]][] = [];
    for (const [key, value] of Object.entries(item)) {
      if (key !== 'id' && isItemList(value)) {
        own[key] = { $ids: value.map(child => child.id) };
        nested.push([key, value]);
      } else own[key] = value;
    }
    out.set(path, { parent: owner, field, kind: 'item', value: canonical(own) });
    for (const [key, children] of nested) for (const child of children) addItem(path, key, child);
  };

  for (const [key, value] of Object.entries(parsed.state)) {
    if (value === undefined) continue;
    const path = `/${esc(key)}`;
    if (isItemList(value)) {
      out.set(path, { parent: null, field: null, kind: 'list', value: canonical({ $ids: value.map(item => item.id) }) });
      for (const item of value) addItem(path, null, item);
    } else if (MAP_KEYS.has(key) && isObject(value)) {
      out.set(path, { parent: null, field: null, kind: 'map', value: '"$map"' });
      for (const [entry, entryValue] of Object.entries(value)) {
        if (entryValue === undefined) continue;
        out.set(`${path}/${esc(entry)}`, { parent: path, field: null, kind: 'entry', value: canonical(entryValue) });
      }
    } else {
      out.set(path, { parent: null, field: null, kind: 'value', value: canonical(value) });
    }
  }
  return out;
}

/** Orders children by the owner's saved id list; anything the list doesn't name
 *  (added on the other device while this one reordered) follows in arrival order. */
function ordered(ids: string[] | undefined, children: string[]): string[] {
  if (!ids) return children;
  const byId = new Map(children.map(path => [lastSegment(path), path]));
  const out: string[] = [];
  for (const id of ids) { const path = byId.get(id); if (path) { out.push(path); byId.delete(id); } }
  return [...out, ...byId.values()];
}

/** The inverse of `explode`. */
export function implode(entities: Entities): string {
  const children = new Map<string, Map<string | null, string[]>>();
  for (const [path, entity] of entities) {
    if (entity.parent === null) continue;
    const byField = children.get(entity.parent) ?? new Map<string | null, string[]>();
    byField.set(entity.field, [...(byField.get(entity.field) ?? []), path]);
    children.set(entity.parent, byField);
  }

  const build = (path: string): unknown => {
    const entity = entities.get(path)!;
    const value = JSON.parse(entity.value) as unknown;
    if (entity.kind === 'list') {
      const kids = children.get(path)?.get(null) ?? [];
      return ordered(isMarker(value) ? value.$ids : undefined, kids).map(build);
    }
    if (entity.kind === 'map') {
      const out: Record<string, unknown> = {};
      for (const kid of children.get(path)?.get(null) ?? []) out[lastSegment(kid)] = JSON.parse(entities.get(kid)!.value);
      return out;
    }
    if (entity.kind !== 'item') return value;
    const own = isObject(value) ? { ...value } : {};
    const fields = children.get(path);
    for (const [key, fieldValue] of Object.entries(own)) {
      if (isMarker(fieldValue)) own[key] = ordered(fieldValue.$ids, fields?.get(key) ?? []).map(build);
    }
    // A child whose owner's winning version predates the list (the other device
    // added the first one): the list is rebuilt from the children that exist.
    for (const [key, kids] of fields ?? []) {
      if (key !== null && !isMarker(isObject(value) ? value[key] : undefined)) own[key] = ordered(undefined, kids).map(build);
    }
    return own;
  };

  const state: Record<string, unknown> = {};
  let version: unknown = 0;
  for (const [path, entity] of entities) {
    if (entity.kind === 'envelope') { version = JSON.parse(entity.value); continue; }
    if (entity.parent !== null) continue;
    state[unesc(path.slice(1))] = build(path);
  }
  return JSON.stringify({ state, version });
}

// ── Staging local changes ─────────────────────────────────────────────────────

export interface Stamps { stamps: Record<string, Dot>; tombs: Record<string, Dot> }

export interface Staged extends Stamps {
  clock: Clock;
  /** Paths this device changed or removed since the baseline. */
  changed: string[];
}

/**
 * Gives every change since `base` a dot from this device.
 *
 * `automatic` names what the app itself just did (the daily reset) — path to the
 * value it produced, or null for a removal. A change still matching it is
 * stamped as automatic; anything you then did to that item is yours.
 *
 * With no baseline (a device that has never synced), nothing is stamped: what is
 * here is treated as the device's starting point, which other devices' news
 * replaces and its own unique items survive alongside.
 */
export function stage(base: Baseline | null, current: Entities, prior: Stamps, clock: Clock, me: string,
  now: number, automatic?: Map<string, string | null>): Staged {
  const stamps = { ...prior.stamps }, tombs = { ...prior.tombs };
  if (!base) return { stamps, tombs, clock, changed: [] };
  const changed: string[] = [];
  for (const [path, entity] of current) if (base.get(path) !== fingerprint(entity.value)) changed.push(path);
  for (const path of base.keys()) if (!current.has(path)) changed.push(path);
  if (!changed.length) return { stamps, tombs, clock, changed };
  const counter = (clock[me] ?? 0) + 1;
  for (const path of changed) {
    const value = current.get(path)?.value ?? null;
    const dot: Dot = [me, counter, now, automatic?.has(path) && automatic.get(path) === value ? 1 : 0];
    if (value === null) { tombs[path] = dot; delete stamps[path]; }
    else { stamps[path] = dot; delete tombs[path]; }
  }
  return { stamps, tombs, clock: { ...clock, [me]: counter }, changed };
}

/** Tombstones older than this are forgotten. A device away for longer may bring
 *  a deleted item back; it can be deleted again. */
export const TOMB_DAYS = 120;
export function pruneTombs(tombs: Record<string, Dot>, now: number): Record<string, Dot> {
  const cutoff = now - TOMB_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(tombs).filter(([, dot]) => dot[2] >= cutoff));
}

/**
 * Makes every item here newer than anything any other device has seen, and
 * deletes on every device whatever is not here. The emergency "use this
 * device's data everywhere".
 */
export function stampEverything(current: Entities, known: Iterable<string>, clock: Clock, me: string, now: number): Staged {
  const counter = (clock[me] ?? 0) + 1;
  const stamps: Record<string, Dot> = {}, tombs: Record<string, Dot> = {};
  for (const path of current.keys()) stamps[path] = [me, counter, now, 0];
  for (const path of known) if (!current.has(path)) tombs[path] = [me, counter, now, 0];
  return { stamps, tombs, clock: { ...clock, [me]: counter }, changed: [...current.keys()] };
}

// ── Merge ─────────────────────────────────────────────────────────────────────

export interface Side extends Stamps {
  entities: Entities;
  clock: Clock;
  /** Written by a build before item stamps (3.4.1 and earlier). */
  legacy: boolean;
  device: { id: string; name: string };
  /** When this side last wrote the slot. Only breaks ties between legacy copies. */
  at: string;
}

export interface MergeConflict {
  path: string;
  /** edit: both edited it. delete: one deleted it while the other edited it. */
  kind: 'edit' | 'delete';
  kept: { device: string; value: string | null };
  lost: { device: string; value: string | null };
}

export interface Merged extends Stamps {
  entities: Entities;
  clock: Clock;
  conflicts: MergeConflict[];
  /** Did the result differ from the local side at all. */
  changed: boolean;
}

const seen = (clock: Clock, dot: Dot) => (clock[dot[0]] ?? 0) >= dot[1];
/** Yours beats automatic; then the later; then a fixed order, so every device
 *  settles the same conflict the same way. */
const beats = (a: Dot, b: Dot) =>
  a[3] !== b[3] ? a[3] < b[3] : a[2] !== b[2] ? a[2] > b[2] : a[0] !== b[0] ? a[0] > b[0] : a[1] >= b[1];

/** A dot standing for "whatever a legacy device holds", which every device that
 *  has merged that device's clock has seen. */
const legacyDot = (side: Side): Dot => [side.device.id, side.clock[side.device.id] ?? 0, Date.parse(side.at) || 0, 0];

/** The name the issue list shows for an item, if it is a named thing at all. */
export function entityLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const own = JSON.parse(value) as Record<string, unknown>;
    const label = isObject(own) ? (typeof own.title === 'string' ? own.title : typeof own.name === 'string' ? own.name : null) : null;
    return label?.trim() ? label.trim() : null;
  } catch { return null; }
}

/**
 * Merges what another device holds for one slot into what this device holds.
 *
 * `base` is what this device last stamped, so a change on a device still on an
 * older build (which carries no stamps) can be told apart from an item it simply
 * holds as it was.
 */
export function mergeSides(local: Side, remote: Side, base?: Baseline | null): Merged {
  const entities: Entities = new Map();
  const stamps: Record<string, Dot> = {}, tombs: Record<string, Dot> = {};
  const conflicts: MergeConflict[] = [];
  /** Paths whose surviving version was news to the side that lacked it. */
  const news = new Set<string>();
  /** Items kept although the other side deleted them: they come back whole. */
  const keptOverDelete: { path: string; source: Side }[] = [];
  const relation = compareClocks(remote.clock, local.clock);
  const remoteMayHaveNews = relation === 'ahead' || relation === 'concurrent';

  const paths = new Set<string>([...local.entities.keys(), ...remote.entities.keys(), ...Object.keys(local.tombs), ...Object.keys(remote.tombs)]);
  // Local order first, so a rebuilt store keeps this device's key order.
  for (const path of paths) {
    const l = local.entities.get(path), r = remote.entities.get(path);
    const lDot = l ? local.stamps[path] : local.tombs[path];
    const rDot = r ? remote.stamps[path] : remote.tombs[path];
    const lValue = l?.value ?? null, rValue = r?.value ?? null;

    const keep = (side: 'local' | 'remote', isNews: boolean) => {
      const entity = side === 'local' ? l : r;
      const dot = side === 'local' ? lDot : rDot ?? (remote.legacy && entity ? legacyDot(remote) : undefined);
      if (entity) { entities.set(path, entity); if (dot) stamps[path] = dot; }
      else if (dot) tombs[path] = dot;
      if (isNews) news.add(path);
    };

    if (lValue === rValue) {
      // Same content (or gone on both): nothing to decide. Keep the dot the
      // other side has not seen, so news keeps travelling.
      const pick = lDot && rDot ? (seen(remote.clock, lDot) && !seen(local.clock, rDot) ? 'remote' : 'local') : lDot ? 'local' : rDot ? 'remote' : 'local';
      keep(pick, false);
      continue;
    }

    const lNew = lDot ? !seen(remote.clock, lDot) : false;
    let rNew: boolean;
    if (rDot) rNew = !seen(local.clock, rDot);
    else if (!remote.legacy || !remoteMayHaveNews) rNew = false;
    // An older build settles conflicts by keeping one whole copy, so what it
    // holds may be stale: a laptop opened after days reverts everything. Its
    // copy can add items, and change items no newer build has changed by hand —
    // it never deletes, and never undoes a change you made on a newer build.
    else if (!r || (lDot && lDot[3] === 0)) rNew = false;
    else if (base) rNew = fingerprint(rValue!) !== (base.get(path) ?? null);
    else rNew = true;

    if (lNew && !rNew) {
      keep('local', true);
    } else if (rNew && !lNew) {
      keep('remote', true);
    } else if (!lNew && !rNew) {
      // Neither side has news about it, yet they differ: copies from before item
      // stamps, a tombstone since forgotten, or an older build's stale copy.
      // Never drop an item on that evidence; prefer the version a newer build
      // stamped; otherwise the copy that has seen more wins.
      if (!l || !r) keep(l ? 'local' : 'remote', false);
      else if (lDot && !rDot) keep('local', false);
      else if (rDot && !lDot) keep('remote', false);
      else if (relation === 'ahead') keep('remote', false);
      else if (relation === 'behind') keep('local', false);
      else keep((remote.at > local.at || (remote.at === local.at && remote.device.id > local.device.id)) ? 'remote' : 'local', false);
    } else {
      // Both changed it without seeing the other.
      const ld = lDot ?? legacyDot(local), rd = rDot ?? legacyDot(remote);
      if (!l || !r) {
        // Edited on one, deleted on the other. An edit you made keeps it; the
        // daily reset touching an item does not resurrect it.
        const present = l ? ld : rd;
        const keepPresent = present[3] === 0;
        const winner: 'local' | 'remote' = keepPresent === !!l ? 'local' : 'remote';
        keep(winner, true);
        if (keepPresent) keptOverDelete.push({ path, source: l ? local : remote });
        if (keepPresent) conflicts.push({ path, kind: 'delete',
          kept: { device: l ? local.device.name : remote.device.name, value: l ? lValue : rValue },
          lost: { device: l ? remote.device.name : local.device.name, value: null } });
      } else {
        const localWins = beats(ld, rd);
        keep(localWins ? 'local' : 'remote', true);
        if (ld[3] === 0 && rd[3] === 0) conflicts.push({ path, kind: 'edit',
          kept: { device: localWins ? local.device.name : remote.device.name, value: localWins ? lValue : rValue },
          lost: { device: localWins ? remote.device.name : local.device.name, value: localWins ? rValue : lValue } });
      }
    }
  }

  // An item that survived as news under an owner that was deleted brings its
  // owner back: the deletion did not know about it. Anything else under a
  // deleted owner goes with it.
  const resurrect = (path: string): boolean => {
    if (entities.has(path)) return true;
    const source = local.entities.get(path) ? local : remote.entities.get(path) ? remote : null;
    const entity = source?.entities.get(path);
    if (!source || !entity) return false;
    if (entity.parent !== null && !resurrect(entity.parent)) return false;
    entities.set(path, entity);
    const dot = source.stamps[path] ?? (source.legacy ? legacyDot(source) : undefined);
    if (dot) stamps[path] = dot;
    delete tombs[path];
    keptOverDelete.push({ path, source });
    conflicts.push({ path, kind: 'delete', kept: { device: source.device.name, value: entity.value },
      lost: { device: source === local ? remote.device.name : local.device.name, value: null } });
    return true;
  };
  const newsAtOrBelow = (path: string) => [...news].some(item => item === path || item.startsWith(`${path}/`));
  const byDepth = [...entities.keys()].sort((a, b) => a.split('/').length - b.split('/').length);
  for (const path of byDepth) {
    const entity = entities.get(path);
    if (!entity || entity.parent === null || entities.has(entity.parent)) continue;
    if (!newsAtOrBelow(path) || !resurrect(entity.parent)) {
      // Removing an orphan removes its own children too.
      for (const other of [...entities.keys()]) if (other === path || other.startsWith(`${path}/`)) { entities.delete(other); delete stamps[other]; }
    }
  }

  // What was kept over a deletion comes back with everything the keeping side
  // still holds inside it, not just the parts it happened to touch.
  for (const { path: root, source } of keptOverDelete) {
    if (!entities.has(root)) continue;
    for (const [path, entity] of source.entities) {
      if (!path.startsWith(`${root}/`) || entities.has(path) || (entity.parent && !entities.has(entity.parent))) continue;
      entities.set(path, entity);
      const dot = source.stamps[path] ?? (source.legacy ? legacyDot(source) : undefined);
      if (dot) stamps[path] = dot;
      delete tombs[path];
      }
  }

  // Rebuild in local order with remote additions after, and say whether
  // anything here actually moved.
  const ordered: Entities = new Map();
  for (const path of local.entities.keys()) if (entities.has(path)) ordered.set(path, entities.get(path)!);
  for (const [path, entity] of entities) if (!ordered.has(path)) ordered.set(path, entity);
  const result = normalize(ordered, stamps);
  let changed = result.size !== local.entities.size;
  if (!changed) for (const [path, entity] of result) if (local.entities.get(path)?.value !== entity.value) { changed = true; break; }

  return { entities: result, stamps, tombs, clock: mergeClocks(local.clock, remote.clock), conflicts, changed };
}

/**
 * Makes every list say exactly which items it holds, in the order the store will
 * hold them.
 *
 * After a merge a list can name an item that is gone, or miss one the other
 * device added while this one reordered. Rewriting the id lists here — the same
 * way on every device — means the merged entities are exactly what reading the
 * rebuilt store back would give, so the merge itself never looks like a fresh
 * local edit. Items the list does not name follow, oldest change first.
 */
export function normalize(entities: Entities, stamps: Record<string, Dot>): Entities {
  const children = new Map<string, Map<string | null, string[]>>();
  for (const [path, entity] of entities) {
    if (entity.parent === null || entity.kind === 'entry') continue;
    const byField = children.get(entity.parent) ?? new Map<string | null, string[]>();
    byField.set(entity.field, [...(byField.get(entity.field) ?? []), path]);
    children.set(entity.parent, byField);
  }
  const orderOf = (ids: string[] | undefined, kids: string[]) => {
    const named = new Map(kids.map(path => [lastSegment(path), path]));
    const out: string[] = [];
    for (const id of ids ?? []) if (named.has(id)) { out.push(id); named.delete(id); }
    const extras = [...named.values()].sort((a, b) => (stamps[a]?.[2] ?? 0) - (stamps[b]?.[2] ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    return [...out, ...extras.map(lastSegment)];
  };

  const out: Entities = new Map();
  for (const [path, entity] of entities) {
    const fields = children.get(path);
    if ((entity.kind === 'list' || entity.kind === 'value') && entity.parent === null) {
      const kids = fields?.get(null);
      if (entity.kind === 'value' && !kids?.length) { out.set(path, entity); continue; }
      const current = JSON.parse(entity.value) as unknown;
      const ids = orderOf(isMarker(current) ? current.$ids : undefined, kids ?? []);
      out.set(path, ids.length
        ? { ...entity, kind: 'list', value: canonical({ $ids: ids }) }
        : { ...entity, kind: 'value', value: '[]' });
      continue;
    }
    if (entity.kind !== 'item') { out.set(path, entity); continue; }
    const own = JSON.parse(entity.value) as Record<string, unknown>;
    let touched = false;
    for (const [key, value] of Object.entries(own)) {
      if (!isMarker(value)) continue;
      const ids = orderOf(value.$ids, fields?.get(key) ?? []);
      own[key] = ids.length ? { $ids: ids } : [];
      touched = true;
    }
    for (const [key, kids] of fields ?? []) {
      if (key === null || isMarker(own[key])) continue;
      own[key] = { $ids: orderOf(undefined, kids) };
      touched = true;
    }
    out.set(path, touched ? { ...entity, value: canonical(own) } : entity);
  }
  return out;
}

/** The named items in `source` that are missing here, each with whatever owners
 *  it needs to exist — the "bring back what's missing" half of recovery. */
export function missingItems(current: Entities, source: Entities): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  for (const [path, entity] of source) {
    if (entity.kind !== 'item' || current.has(path)) continue;
    // Only the topmost missing item is listed; its children come with it.
    if (entity.parent && !current.has(entity.parent) && source.get(entity.parent)?.kind === 'item') continue;
    out.push({ path, label: entityLabel(entity.value) ?? 'Untitled item' });
  }
  return out;
}

/** The named items both copies hold, in different versions. */
export function differingItems(current: Entities, source: Entities): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [];
  for (const [path, entity] of source) {
    const mine = current.get(path);
    if (entity.kind !== 'item' || !mine || mine.value === entity.value) continue;
    if (sameOwnFields(mine.value, entity.value)) continue;
    out.push({ path, label: entityLabel(entity.value) ?? entityLabel(mine.value) ?? 'Untitled item' });
  }
  return out;
}

/** Equal apart from which children they hold — that is the children's
 *  business, and each child is compared on its own. */
function sameOwnFields(a: string, b: string): boolean {
  const left = JSON.parse(a) as Record<string, unknown>, right = JSON.parse(b) as Record<string, unknown>;
  const isList = (value: unknown) => isMarker(value) || (Array.isArray(value) && value.length === 0);
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if ((isMarker(left[key]) || isMarker(right[key])) && isList(left[key] ?? []) && isList(right[key] ?? [])) continue;
    if (canonical(left[key]) !== canonical(right[key])) return false;
  }
  return true;
}

/** Sets the chosen items' own fields to `source`'s version, keeping each one's
 *  children as they are here. */
export function withVersions(current: Entities, source: Entities, paths: string[]): Entities {
  const out: Entities = new Map(current);
  for (const path of paths) {
    const mine = out.get(path), theirs = source.get(path);
    if (!mine || !theirs || mine.kind !== 'item') continue;
    const own = JSON.parse(theirs.value) as Record<string, unknown>;
    const kept = JSON.parse(mine.value) as Record<string, unknown>;
    for (const [key, field] of Object.entries(kept)) if (isMarker(field)) own[key] = field;
    for (const [key, field] of Object.entries(own)) if (isMarker(field) && !isMarker(kept[key])) delete own[key];
    out.set(path, { ...mine, value: canonical(own) });
  }
  return normalize(out, {});
}

/** Copies the chosen items (and their contents, and any missing owners) from
 *  `source` into `current`. Never removes or overwrites anything. */
export function withItems(current: Entities, source: Entities, paths: string[]): Entities {
  const out: Entities = new Map(current);
  const add = (path: string) => {
    if (out.has(path)) return;
    const entity = source.get(path);
    if (!entity) return;
    if (entity.parent && !out.has(entity.parent)) add(entity.parent);
    out.set(path, entity);
  };
  for (const path of paths) {
    add(path);
    for (const other of source.keys()) if (other.startsWith(`${path}/`)) add(other);
  }
  return normalize(out, {});
}
