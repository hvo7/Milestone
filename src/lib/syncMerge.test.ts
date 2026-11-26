/**
 * Item-level merge: the rules that decide whether a change made on one device
 * survives contact with another device's copy. Pure functions, tested directly.
 */
import { describe, expect, it } from 'vitest';
import {
  explode, implode, stage, mergeSides, normalize, missingItems, withItems, stampEverything, canonical, pruneTombs, entityLabel, baselineOf, fingerprint,
  differingItems, withVersions,
  type Baseline, type Side, type Dot, type Stamps,
} from './syncMerge';
import type { Clock } from './syncClock';

type Json = Record<string, unknown>;
const slot = (state: Json) => JSON.stringify({ state, version: 0 });
const state = (raw: string) => JSON.parse(raw).state as Json;
const ql = (id: string, title: string, quests: Json[] = []) => ({ id, title, description: '', icon: '⚔', color: 'sapphire', quests });
const quest = (id: string, title: string, actions: Json[] = []) => ({ id, title, description: '', order: 0, actions });
const action = (id: string, title: string, completed = false) => ({ id, title, completed });
const habit = (id: string, title: string, extra: Json = {}) => ({ id, title, recurring: 'daily', completed: false, trackedToday: true, ...extra });
const questState = (questlines: Json[], routines: Json[] = [], extra: Json = {}) =>
  slot({ questlines, routines, systems: [], completionLog: {}, taskHistory: {}, todoOrder: {}, ...extra });

/** A device holding a copy, with the bookkeeping sync keeps for it. */
class Device {
  id: string;
  raw: string;
  base: Baseline | null;
  stamps: Stamps = { stamps: {}, tombs: {} };
  clock: Clock = {};
  at = '2026-11-01T00:00:00.000Z';
  constructor(id: string, raw: string, synced = true) { this.id = id; this.raw = raw; this.base = synced ? baselineOf(explode(raw)!) : null; }
  edit(fn: (s: Json) => void) { const s = state(this.raw); fn(s); this.raw = slot(s); return this; }
  /** Stamp what changed since the last sync, as publishing would. */
  commit(now: number, automatic?: Map<string, string | null>) {
    const current = explode(this.raw)!;
    const staged = stage(this.base, current, this.stamps, this.clock, this.id, now, automatic);
    this.stamps = { stamps: staged.stamps, tombs: staged.tombs };
    this.clock = staged.clock; this.base = baselineOf(current); this.at = new Date(now).toISOString();
    return this;
  }
  side(legacy = false): Side {
    return { entities: explode(this.raw)!, ...(legacy ? { stamps: {}, tombs: {} } : this.stamps), clock: this.clock, legacy, device: { id: this.id, name: this.id }, at: this.at };
  }
  /** Take in another device's copy. */
  receive(other: Device, legacy = false) {
    const merged = mergeSides(this.side(), other.side(legacy), this.base);
    this.raw = implode(merged.entities);
    this.stamps = { stamps: merged.stamps, tombs: merged.tombs };
    this.clock = merged.clock; this.base = baselineOf(merged.entities);
    return merged;
  }
  clone(id: string) { const copy = new Device(id, this.raw); copy.clock = { ...this.clock }; copy.stamps = structuredClone(this.stamps); return copy; }
}

const titles = (raw: string) => (state(raw).questlines as Json[]).map(q => q.title);

describe('explode and implode', () => {
  const sample = slot({
    questlines: [ql('a', 'Learn Korean', [quest('q1', 'Hangul', [action('x1', 'Vowels', true), action('x2', 'Consonants')])]), ql('b', 'Fitness')],
    routines: [habit('walk', 'Walk', { subtasks: [{ id: 's1', title: 'Shoes', completed: false, children: [{ id: 's2', title: 'Laces', completed: true }] }], sessionDays: ['2026-11-01'] })],
    systems: [], spaces: [{ id: 'vynues', name: 'Vynues' }],
    completionLog: { '2026-11-01': 3, '2026-11-02': 1 }, taskHistory: { walk: ['2026-11-01'] }, todoOrder: { walk: 0 },
    anchorSystemRetired: true, sessionDaysEmpty: [],
  });

  it('round-trips a realistic store exactly', () => {
    expect(JSON.parse(implode(explode(sample)!))).toEqual(JSON.parse(sample));
  });

  it('gives every nested item its own entity, keyed by its id path', () => {
    const entities = explode(sample)!;
    expect(entities.has('/questlines/a/quests/q1/actions/x2')).toBe(true);
    expect(entities.has('/routines/walk/subtasks/s1/children/s2')).toBe(true);
    expect(entities.get('/completionLog/2026-11-02')?.value).toBe('1');
    expect(JSON.parse(entities.get('/questlines/a')!.value).quests).toEqual({ $ids: ['q1'] });
  });

  it('treats ids with slashes and tildes as single path segments', () => {
    const raw = slot({ questlines: [ql('a/b~c', 'Odd id')] });
    expect(JSON.parse(implode(explode(raw)!))).toEqual(JSON.parse(raw));
  });

  it('rejects something that is not a slot', () => {
    expect(explode('nope')).toBeNull();
    expect(explode(JSON.stringify({ state: [] }))).toBeNull();
    expect(explode(undefined)).toBeNull();
  });

  it('fingerprints values so a changed one never matches', () => {
    expect(fingerprint('{"a":1}')).toBe(fingerprint('{"a":1}'));
    expect(fingerprint('{"a":1}')).not.toBe(fingerprint('{"a":2}'));
    expect(fingerprint('ab')).not.toBe(fingerprint('ba'));
  });

  it('compares values regardless of key order', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(canonical({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
  });
});

describe('staging local changes', () => {
  it('stamps only what changed, with one new counter', () => {
    const device = new Device('phone', questState([ql('a', 'A'), ql('b', 'B')]));
    device.clock = { phone: 4, laptop: 2 };
    device.edit(s => { (s.questlines as Json[])[1].title = 'B2'; (s.questlines as Json[]).splice(0, 1); }).commit(1000);
    expect(device.clock).toEqual({ phone: 5, laptop: 2 });
    expect(device.stamps.stamps['/questlines/b']).toEqual(['phone', 5, 1000, 0]);
    expect(device.stamps.tombs['/questlines/a']).toEqual(['phone', 5, 1000, 0]);
    expect(Object.keys(device.stamps.stamps)).toEqual(['/questlines', '/questlines/b']);
  });

  it('does nothing when nothing changed', () => {
    const device = new Device('phone', questState([ql('a', 'A')]));
    device.commit(1000);
    expect(device.clock).toEqual({});
  });

  it('marks what the app itself did as automatic, until you change it', () => {
    const device = new Device('laptop', questState([], [habit('walk', 'Walk', { completed: true })]));
    device.edit(s => { (s.routines as Json[])[0].completed = false; });
    const reset = explode(device.raw)!.get('/routines/walk')!.value;
    device.commit(1000, new Map([['/routines/walk', reset]]));
    expect(device.stamps.stamps['/routines/walk'][3]).toBe(1);
    device.edit(s => { (s.routines as Json[])[0].title = 'Long walk'; }).commit(2000, new Map([['/routines/walk', reset]]));
    expect(device.stamps.stamps['/routines/walk'][3]).toBe(0);
  });

  it('stamps nothing on a device that has never synced', () => {
    const device = new Device('fresh', questState([ql('a', 'A')]), false);
    device.commit(1000);
    expect(device.stamps.stamps).toEqual({});
    expect(device.clock).toEqual({});
  });
});

describe('merging two copies', () => {
  const shared = () => {
    const laptop = new Device('laptop', questState([ql('a', 'Shared', [quest('q', 'Quest', [action('x', 'Step')])])], [habit('walk', 'Walk')]));
    laptop.clock = { laptop: 3, phone: 5 };
    const phone = laptop.clone('phone');
    return { laptop, phone };
  };

  it('THE REPORTED BUG: a stale laptop\'s daily reset no longer wipes what was made on the phone', () => {
    const { laptop, phone } = shared();
    // On the phone: a new questline, a checked step, and the habit done.
    phone.edit(s => {
      (s.questlines as Json[]).push(ql('p', 'Made on phone'));
      ((((s.questlines as Json[])[0].quests as Json[])[0].actions as Json[])[0]).completed = true;
      (s.routines as Json[])[0].completed = true;
    }).commit(Date.parse('2026-11-24T09:00:00Z'));
    // Days later the laptop opens and its reset touches the habit first.
    laptop.edit(s => { (s.routines as Json[])[0].lastResetAt = '2026-11-26T10:00:00.000Z'; });
    const reset = explode(laptop.raw)!.get('/routines/walk')!.value;
    laptop.commit(Date.parse('2026-11-26T10:00:00Z'), new Map([['/routines/walk', reset]]));

    const merged = laptop.receive(phone);
    expect(titles(laptop.raw)).toEqual(['Shared', 'Made on phone']);
    const s = state(laptop.raw);
    expect((((s.questlines as Json[])[0].quests as Json[])[0].actions as Json[])[0].completed).toBe(true);
    // Your check-off beats the automatic reset that never saw it.
    expect((s.routines as Json[])[0].completed).toBe(true);
    expect(merged.conflicts).toEqual([]);

    // And the phone, taking the laptop's copy back, loses nothing either.
    phone.receive(laptop);
    expect(canonical(state(phone.raw))).toBe(canonical(state(laptop.raw)));
  });

  it('keeps independent edits to different items on both devices', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.questlines as Json[])[0].title = 'Renamed on phone'; }).commit(2000);
    laptop.edit(s => { (s.routines as Json[])[0].title = 'Renamed on laptop'; }).commit(1000);
    laptop.receive(phone);
    const s = state(laptop.raw);
    expect((s.questlines as Json[])[0].title).toBe('Renamed on phone');
    expect((s.routines as Json[])[0].title).toBe('Renamed on laptop');
  });

  it('settles a real edit-edit conflict the same way on both devices and reports what was set aside', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.questlines as Json[])[0].title = 'Phone title'; }).commit(2000);
    laptop.edit(s => { (s.questlines as Json[])[0].title = 'Laptop title'; }).commit(1000);
    const onLaptop = mergeSides(laptop.side(), phone.side(), laptop.base);
    const onPhone = mergeSides(phone.side(), laptop.side(), phone.base);
    expect(canonical(state(implode(onLaptop.entities)))).toBe(canonical(state(implode(onPhone.entities))));
    expect(titles(implode(onLaptop.entities))).toEqual(['Phone title']);
    expect(onLaptop.conflicts).toEqual([expect.objectContaining({ path: '/questlines/a', kind: 'edit',
      kept: expect.objectContaining({ device: 'phone' }), lost: expect.objectContaining({ device: 'laptop' }) })]);
    expect(entityLabel(onLaptop.conflicts[0].lost.value)).toBe('Laptop title');
  });

  it('takes the other side\'s change when this side only has an older version', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.questlines as Json[])[0].title = 'Newer'; }).commit(2000);
    const merged = laptop.receive(phone);
    expect(titles(laptop.raw)).toEqual(['Newer']);
    expect(merged.changed).toBe(true);
    // A second exchange finds nothing to do.
    expect(laptop.receive(phone).changed).toBe(false);
  });

  it('deletes on both when one side deleted and the other did not touch it', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.routines as Json[]).splice(0, 1); }).commit(2000);
    laptop.receive(phone);
    expect(state(laptop.raw).routines).toEqual([]);
  });

  it('keeps an item that was edited on one device while deleted on the other', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.routines as Json[]).splice(0, 1); }).commit(2000);
    laptop.edit(s => { (s.routines as Json[])[0].title = 'Still wanted'; }).commit(3000);
    const merged = laptop.receive(phone);
    expect((state(laptop.raw).routines as Json[]).map(r => r.title)).toEqual(['Still wanted']);
    expect(merged.conflicts).toEqual([expect.objectContaining({ path: '/routines/walk', kind: 'delete' })]);
    phone.receive(laptop);
    expect((state(phone.raw).routines as Json[]).map(r => r.title)).toEqual(['Still wanted']);
  });

  it('lets a deletion win over the daily reset touching the same item', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.routines as Json[]).splice(0, 1); }).commit(2000);
    laptop.edit(s => { (s.routines as Json[])[0].lastResetAt = 'later'; });
    laptop.commit(3000, new Map([['/routines/walk', explode(laptop.raw)!.get('/routines/walk')!.value]]));
    const merged = laptop.receive(phone);
    expect(state(laptop.raw).routines).toEqual([]);
    expect(merged.conflicts).toEqual([]);
  });

  it('brings a deleted questline back when the other device added a step inside it', () => {
    const { laptop, phone } = shared();
    laptop.edit(s => { (s.questlines as Json[]).splice(0, 1); }).commit(2000);
    phone.edit(s => { (((s.questlines as Json[])[0].quests as Json[])[0].actions as Json[]).push(action('new', 'New step')); }).commit(1000);
    const merged = laptop.receive(phone);
    const s = state(laptop.raw);
    expect(titles(laptop.raw)).toEqual(['Shared']);
    expect((((s.questlines as Json[])[0].quests as Json[])[0].actions as Json[]).map(a => a.id)).toEqual(['x', 'new']);
    expect(merged.conflicts.map(c => c.path)).toContain('/questlines/a');
  });

  it('drops a deleted questline\'s untouched contents with it', () => {
    const { laptop, phone } = shared();
    laptop.edit(s => { (s.questlines as Json[]).splice(0, 1); }).commit(2000);
    phone.edit(s => { (s.routines as Json[])[0].title = 'Unrelated'; }).commit(1000);
    laptop.receive(phone);
    expect(state(laptop.raw).questlines).toEqual([]);
  });

  it('keeps items added on both devices, in a single agreed order', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.questlines as Json[]).push(ql('p1', 'Phone 1'), ql('p2', 'Phone 2')); }).commit(2000);
    laptop.edit(s => { (s.questlines as Json[]).push(ql('l1', 'Laptop 1')); }).commit(1000);
    const onLaptop = mergeSides(laptop.side(), phone.side(), laptop.base);
    const onPhone = mergeSides(phone.side(), laptop.side(), phone.base);
    expect(titles(implode(onLaptop.entities))).toEqual(['Shared', 'Phone 1', 'Phone 2', 'Laptop 1']);
    expect(titles(implode(onPhone.entities))).toEqual(titles(implode(onLaptop.entities)));
  });

  it('merges heatmap days and per-task history key by key', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { s.completionLog = { '2026-11-24': 2 }; s.taskHistory = { walk: ['2026-11-24'] }; }).commit(2000);
    laptop.edit(s => { s.completionLog = { '2026-11-26': 1 }; }).commit(1000);
    laptop.receive(phone);
    expect(state(laptop.raw).completionLog).toEqual({ '2026-11-24': 2, '2026-11-26': 1 });
    expect(state(laptop.raw).taskHistory).toEqual({ walk: ['2026-11-24'] });
  });

  it('produces entities identical to reading the rebuilt store back, so a merge is never mistaken for an edit', () => {
    const { laptop, phone } = shared();
    phone.edit(s => { (s.questlines as Json[]).push(ql('p1', 'Phone 1')); (s.questlines as Json[])[0].title = 'T'; }).commit(2000);
    laptop.edit(s => { (s.questlines as Json[]).unshift(ql('l1', 'Laptop 1')); }).commit(3000);
    const merged = mergeSides(laptop.side(), phone.side(), laptop.base);
    const reread = explode(implode(merged.entities))!;
    expect([...reread].map(([path, e]) => [path, e.value]).sort()).toEqual([...merged.entities].map(([path, e]) => [path, e.value]).sort());
  });

  it('converges three devices whatever order they exchange in', () => {
    const { laptop, phone } = shared();
    const desktop = laptop.clone('desktop');
    phone.edit(s => { (s.questlines as Json[]).push(ql('p', 'Phone')); }).commit(1000);
    laptop.edit(s => { (s.routines as Json[]).push(habit('read', 'Read')); }).commit(2000);
    desktop.edit(s => { (s.questlines as Json[])[0].title = 'Desktop title'; }).commit(3000);
    desktop.receive(phone); laptop.receive(desktop); phone.receive(laptop); desktop.receive(laptop);
    for (const device of [laptop, phone, desktop]) {
      expect(canonical(state(device.raw))).toBe(canonical(state(desktop.raw)));
    }
    expect(titles(desktop.raw)).toEqual(['Desktop title', 'Phone']);
    expect((state(desktop.raw).routines as Json[]).map(r => r.id)).toEqual(['walk', 'read']);
  });
});

describe('a device still on an older build', () => {
  it('never loses items it holds that this device has not seen', () => {
    const laptop = new Device('laptop', questState([ql('a', 'Shared')]));
    laptop.clock = { laptop: 3, phone: 5 };
    const oldPhone = laptop.clone('phone');
    oldPhone.edit(s => { (s.questlines as Json[]).push(ql('p', 'Phone, old build')); });
    oldPhone.clock = { laptop: 3, phone: 6 };
    laptop.edit(s => { (s.questlines as Json[]).push(ql('l', 'Laptop')); }).commit(1000);
    laptop.receive(oldPhone, true);
    expect(titles(laptop.raw).sort()).toEqual(['Laptop', 'Phone, old build', 'Shared']);
  });

  it('takes its changes to items this device did not change', () => {
    const laptop = new Device('laptop', questState([ql('a', 'Shared')]));
    laptop.clock = { laptop: 3, phone: 5 };
    const oldPhone = laptop.clone('phone');
    oldPhone.edit(s => { (s.questlines as Json[])[0].title = 'Renamed on old phone'; });
    oldPhone.clock = { laptop: 3, phone: 6 };
    laptop.receive(oldPhone, true);
    expect(titles(laptop.raw)).toEqual(['Renamed on old phone']);
  });

  it('does not delete what it simply never received', () => {
    const laptop = new Device('laptop', questState([ql('a', 'Shared')]));
    laptop.clock = { laptop: 3, phone: 5 };
    const oldPhone = laptop.clone('phone');
    laptop.edit(s => { (s.questlines as Json[]).push(ql('l', 'New on laptop')); }).commit(1000);
    oldPhone.edit(s => { (s.questlines as Json[])[0].title = 'Phone edit'; });
    oldPhone.clock = { laptop: 3, phone: 6 };
    laptop.receive(oldPhone, true);
    expect(titles(laptop.raw)).toEqual(['Phone edit', 'New on laptop']);
  });

  it('never lets its stale copy delete or undo an item changed here by hand', () => {
    const laptop = new Device('laptop', questState([ql('a', 'Shared')]));
    laptop.clock = { laptop: 3, phone: 5 };
    laptop.edit(s => { (s.questlines as Json[]).push(ql('l', 'Made here')); (s.questlines as Json[])[0].title = 'Renamed here'; }).commit(1000);
    // The old build saw that publish but kept its own whole copy.
    const oldPhone = laptop.clone('phone');
    oldPhone.edit(s => { (s.questlines as Json[]).splice(1, 1); (s.questlines as Json[])[0].title = 'Shared'; });
    oldPhone.clock = { laptop: 4, phone: 6 };
    const merged = laptop.receive(oldPhone, true);
    expect(titles(laptop.raw)).toEqual(['Renamed here', 'Made here']);
    expect(merged.conflicts).toEqual([]);
  });

  it('still takes its change to an item only the daily reset touched here', () => {
    const laptop = new Device('laptop', questState([], [habit('walk', 'Walk')]));
    laptop.clock = { laptop: 3, phone: 5 };
    const oldPhone = laptop.clone('phone');
    laptop.edit(s => { (s.routines as Json[])[0].lastResetAt = 'reset'; });
    laptop.commit(1000, new Map([['/routines/walk', explode(laptop.raw)!.get('/routines/walk')!.value]]));
    oldPhone.edit(s => { (s.routines as Json[])[0].completed = true; });
    oldPhone.clock = { laptop: 3, phone: 6 };
    laptop.receive(oldPhone, true);
    expect((state(laptop.raw).routines as Json[])[0].completed).toBe(true);
  });

  it('settles on the stamped version once that device updates', () => {
    const desktop = new Device('desktop', questState([ql('a', 'Shared')]));
    desktop.clock = { desktop: 3, laptop: 5 };
    const laptop = desktop.clone('laptop');
    desktop.edit(s => { (s.questlines as Json[])[0].title = 'Desktop edit'; }).commit(1000);
    // The laptop, on the old build, saw the clock but kept its stale title.
    laptop.clock = { desktop: 4, laptop: 6 };
    desktop.receive(laptop, true);
    expect(titles(desktop.raw)).toEqual(['Desktop edit']);
    // Updated, the laptop now merges the desktop's stamped copy.
    laptop.receive(desktop);
    expect(titles(laptop.raw)).toEqual(['Desktop edit']);
  });
});

describe('recovery helpers', () => {
  it('lists and restores only the items missing here, with their contents', () => {
    const current = explode(questState([ql('a', 'Kept')]))!;
    const source = explode(questState([ql('a', 'Kept'), ql('b', 'Lost', [quest('q', 'Lost quest', [action('x', 'Lost step')])])]))!;
    expect(missingItems(current, source)).toEqual([{ path: '/questlines/b', label: 'Lost' }]);
    const restored = state(implode(withItems(current, source, ['/questlines/b'])));
    expect((restored.questlines as Json[]).map(q => q.title)).toEqual(['Kept', 'Lost']);
    expect((((restored.questlines as Json[])[1].quests as Json[])[0].actions as Json[])[0].title).toBe('Lost step');
  });

  it('lists items whose own fields differ, and sets just those fields back', () => {
    const current = explode(questState([ql('a', 'Now', [quest('q', 'Q', [action('x', 'Step')])])]))!;
    const source = explode(questState([ql('a', 'Before', [quest('q', 'Q')])]))!;
    expect(differingItems(current, source)).toEqual([{ path: '/questlines/a', label: 'Before' }]);
    const restored = state(implode(withVersions(current, source, ['/questlines/a'])));
    expect((restored.questlines as Json[])[0].title).toBe('Before');
    expect((((restored.questlines as Json[])[0].quests as Json[])[0].actions as Json[]).map(a => a.id)).toEqual(['x']);
  });

  it('lists a missing step under an existing quest on its own', () => {
    const current = explode(questState([ql('a', 'A', [quest('q', 'Q')])]))!;
    const source = explode(questState([ql('a', 'A', [quest('q', 'Q', [action('x', 'Step')])])]))!;
    expect(missingItems(current, source)).toEqual([{ path: '/questlines/a/quests/q/actions/x', label: 'Step' }]);
  });

  it('makes this device\'s copy beat every other device\'s on request', () => {
    const { laptop, phone } = (() => {
      const l = new Device('laptop', questState([ql('a', 'A')])); l.clock = { laptop: 1, phone: 1 };
      return { laptop: l, phone: l.clone('phone') };
    })();
    phone.edit(s => { (s.questlines as Json[]).push(ql('p', 'Phone')); (s.questlines as Json[])[0].title = 'Phone A'; }).commit(5000);
    laptop.clock = { laptop: 1, phone: 2 };
    const forced = stampEverything(explode(laptop.raw)!, explode(phone.raw)!.keys(), laptop.clock, 'laptop', 6000);
    laptop.stamps = { stamps: forced.stamps, tombs: forced.tombs }; laptop.clock = forced.clock;
    phone.receive(laptop);
    expect(titles(phone.raw)).toEqual(['A']);
  });

  it('forgets tombstones after the retention window', () => {
    const old: Dot = ['a', 1, Date.parse('2026-01-01'), 0];
    const recent: Dot = ['a', 2, Date.parse('2026-11-01'), 0];
    expect(pruneTombs({ '/x': old, '/y': recent }, Date.parse('2026-11-26'))).toEqual({ '/y': recent });
  });

  it('normalizes a list that names a missing item', () => {
    const entities = explode(questState([ql('a', 'A'), ql('b', 'B')]))!;
    entities.delete('/questlines/b');
    expect(normalize(entities, {}).get('/questlines')!.value).toBe('{"$ids":["a"]}');
  });
});

describe('randomised exchanges', () => {
  /** Small deterministic generator so a failure can be replayed. */
  const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('three devices converge and keep every item nobody deleted (seed %i)', seed => {
    const random = rng(seed);
    const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)];
    let now = 1_000;
    const start = new Device('desktop', questState([ql('a', 'A', [quest('q', 'Q', [action('x', 'X')])]), ql('b', 'B')], [habit('h', 'H')]));
    start.clock = { desktop: 1 };
    const devices = [start, start.clone('laptop'), start.clone('phone')];
    const created = new Set<string>(), deleted = new Set<string>();

    for (let round = 0; round < 40; round++) {
      const device = pick(devices);
      const op = random();
      device.edit(s => {
        const lines = s.questlines as Json[];
        if (op < 0.3) {
          const id = `${device.id}-${round}`;
          lines.push(ql(id, `New ${id}`)); created.add(id);
        } else if (op < 0.55 && lines.length) {
          pick(lines).title = `Edit ${round}`;
        } else if (op < 0.7 && lines.length) {
          const line = pick(lines);
          const quests = line.quests as Json[];
          const id = `${device.id}-q${round}`;
          quests.push(quest(id, `Quest ${round}`));
        } else if (op < 0.8 && lines.length > 1) {
          const index = Math.floor(random() * lines.length);
          deleted.add(lines[index].id as string);
          lines.splice(index, 1);
        } else {
          const habits = s.routines as Json[];
          if (habits.length) habits[0].completed = !habits[0].completed;
        }
      });
      device.commit(now += 1000);
      if (random() < 0.5) { const other = pick(devices.filter(d => d !== device)); device.receive(other); }
    }
    // Everyone talks to everyone until nothing moves.
    for (let pass = 0; pass < 3; pass++) for (const a of devices) for (const b of devices) if (a !== b) a.receive(b);

    const finals = devices.map(device => canonical(state(device.raw)));
    expect(new Set(finals).size).toBe(1);
    const ids = new Set((state(devices[0].raw).questlines as Json[]).map(line => line.id as string));
    for (const id of created) if (!deleted.has(id)) expect(ids.has(id)).toBe(true);
    // And a merged copy is never mistaken for a local edit afterwards.
    for (const device of devices) { const before = { ...device.clock }; device.commit(now += 1000); expect(device.clock).toEqual(before); }
  });
});
