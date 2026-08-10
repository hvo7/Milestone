/**
 * Vector-clock reasoning behind cross-computer sync.
 *
 * These are the rules that decide whether one machine's work survives contact
 * with another's, so they get tested directly rather than through the folder
 * plumbing. The functions here are pure; the IPC around them is not, and is
 * deliberately out of scope.
 */
import { describe, it, expect } from 'vitest';
import {
  compareClocks, mergeClocks, slotClock, unionClocks, SLOT_NAMES,
  type Clock, type SyncDoc,
} from './cloudSync';

const doc = (over: Partial<SyncDoc> = {}): SyncDoc => ({
  _milestoneSync: 1,
  deviceId: 'A',
  deviceName: 'Laptop',
  updatedAt: '2026-08-10T12:00:00.000Z',
  clock: {},
  stores: {},
  ...over,
});

describe('compareClocks', () => {
  it('calls identical clocks equal', () => {
    expect(compareClocks({ A: 2, B: 1 }, { A: 2, B: 1 })).toBe('equal');
    expect(compareClocks({}, {})).toBe('equal');
  });

  it('treats an absent entry as zero', () => {
    expect(compareClocks({ A: 1 }, {})).toBe('ahead');
    expect(compareClocks({ A: 0 }, {})).toBe('equal');
  });

  it('detects strict descent in both directions', () => {
    expect(compareClocks({ A: 3, B: 1 }, { A: 2, B: 1 })).toBe('ahead');
    expect(compareClocks({ A: 2, B: 1 }, { A: 3, B: 1 })).toBe('behind');
  });

  it('detects genuine concurrency', () => {
    // Each side advanced its own entry without seeing the other's.
    expect(compareClocks({ A: 2, B: 1 }, { A: 1, B: 2 })).toBe('concurrent');
  });

  it('is antisymmetric', () => {
    const a: Clock = { A: 5, B: 2 };
    const b: Clock = { A: 3, B: 2 };
    expect(compareClocks(a, b)).toBe('ahead');
    expect(compareClocks(b, a)).toBe('behind');
  });
});

describe('mergeClocks', () => {
  it('takes the per-entry maximum', () => {
    expect(mergeClocks({ A: 3, B: 1 }, { A: 1, B: 4, C: 2 })).toEqual({ A: 3, B: 4, C: 2 });
  });

  it('produces something that supersedes both inputs', () => {
    const a: Clock = { A: 2, B: 1 };
    const b: Clock = { A: 1, B: 2 };
    const merged = mergeClocks(a, b);
    expect(compareClocks(merged, a)).toBe('ahead');
    expect(compareClocks(merged, b)).toBe('ahead');
  });

  it('is commutative', () => {
    expect(mergeClocks({ A: 1, B: 5 }, { A: 4 })).toEqual(mergeClocks({ A: 4 }, { A: 1, B: 5 }));
  });
});

describe('slotClock', () => {
  it('reads the per-slot clock when present', () => {
    const d = doc({ clock: { A: 9 }, slotClocks: { quest: { A: 2 }, vynues: { A: 5 } } });
    expect(slotClock(d, 'quest')).toEqual({ A: 2 });
    expect(slotClock(d, 'vynues')).toEqual({ A: 5 });
  });

  it('falls back to the doc clock for documents from older builds', () => {
    // Before per-slot clocks the single clock stood for all three slots, so that
    // is exactly what an old document must be read as meaning.
    const legacy = doc({ clock: { A: 4 } });
    for (const slot of SLOT_NAMES) expect(slotClock(legacy, slot)).toEqual({ A: 4 });
  });

  it('falls back per slot when only some slots are tracked', () => {
    const d = doc({ clock: { A: 7 }, slotClocks: { quest: { A: 1 } } });
    expect(slotClock(d, 'quest')).toEqual({ A: 1 });
    expect(slotClock(d, 'ui')).toEqual({ A: 7 });
  });
});

describe('unionClocks', () => {
  it('summarises every slot for old builds to read', () => {
    expect(unionClocks({ quest: { A: 3 }, vynues: { A: 1, B: 2 }, ui: {} })).toEqual({ A: 3, B: 2 });
  });

  it('is never behind any individual slot', () => {
    const slots = { quest: { A: 3 }, vynues: { B: 9 }, ui: { A: 1 } };
    const union = unionClocks(slots);
    for (const slot of SLOT_NAMES) {
      expect(['ahead', 'equal']).toContain(compareClocks(union, slots[slot]));
    }
  });
});

describe('the scenario per-slot clocks exist for', () => {
  it('sees unrelated edits on different slots as no conflict at all', () => {
    // Laptop edited quests; Desktop edited Vynues. Neither saw the other.
    const laptop = { quest: { L: 2, D: 1 }, vynues: { L: 1, D: 1 }, ui: { L: 1, D: 1 } };
    const desktop = { quest: { L: 1, D: 1 }, vynues: { L: 1, D: 2 }, ui: { L: 1, D: 1 } };

    // Per slot, one side is cleanly ahead and the other cleanly behind —
    // both fast-forward, nothing is discarded.
    expect(compareClocks(laptop.quest, desktop.quest)).toBe('ahead');
    expect(compareClocks(laptop.vynues, desktop.vynues)).toBe('behind');
    expect(compareClocks(laptop.ui, desktop.ui)).toBe('equal');

    // The doc-level clocks an older build would compare are concurrent, which is
    // precisely the false conflict this change removes.
    expect(compareClocks(unionClocks(laptop), unionClocks(desktop))).toBe('concurrent');
  });

  it('still reports a real conflict when the same slot moved on both sides', () => {
    const laptop = { L: 2, D: 1 };
    const desktop = { L: 1, D: 2 };
    expect(compareClocks(laptop, desktop)).toBe('concurrent');
  });

  it('converges after one side adopts the other', () => {
    const laptopQuest: Clock = { L: 2, D: 1 };
    const desktopQuest: Clock = { L: 1, D: 2 };
    // Desktop adopts laptop's quests: it folds in laptop's clock.
    const afterAdopt = mergeClocks(desktopQuest, laptopQuest);
    expect(compareClocks(afterAdopt, laptopQuest)).toBe('ahead');
    // ...and a second pass finds nothing left to do.
    expect(compareClocks(laptopQuest, afterAdopt)).toBe('behind');
  });
});
