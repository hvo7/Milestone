/**
 * Sessions: counting days instead of taps.
 *
 * "Go to the gym 3 times a week" used to be completable from the sofa — three
 * taps of ＋ on Monday read as three visits, and nothing downstream could tell
 * the difference. These pin the rule that closes it: a day counts once, by
 * whichever route you reach it, and a backfilled day lands on the day it
 * happened rather than on today.
 *
 * Split out from store.test.ts because it is a self-contained mode with its own
 * vocabulary, not another wrinkle in the recurrence engine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useQuestStore, sessionMode, sessionOn, cycleDayKeys, dayInitial } from './store';
import type { Routine } from './types';

const localTime = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min);
const AUG = 7;

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Go to the gym', recurring: null, completed: false, trackedToday: false, ...over,
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ── Which tasks count days ───────────────────────────────────────────────────

describe('sessionMode', () => {
  const weekly = (over: Partial<Routine> = {}) => routine({ recurring: 'weekly', target: 3, ...over });

  it('counts days for a multi-day count with no unit', () => {
    expect(sessionMode(weekly())).toBe(true);
  });

  it('counts quantity when there is a unit', () => {
    // "64 oz a week" is an amount you chip at, not an occurrence you repeat.
    expect(sessionMode(weekly({ target: 64, unit: 'oz' }))).toBe(false);
  });

  it('never applies to a daily task or a plain checkbox', () => {
    expect(sessionMode(routine({ recurring: 'daily', target: 3 }))).toBe(false);
    expect(sessionMode(routine({ recurring: 'weekly' }))).toBe(false);
  });

  it('takes an explicit override in either direction', () => {
    expect(sessionMode(weekly({ target: 64, unit: 'oz', oncePerDay: true }))).toBe(true);
    expect(sessionMode(weekly({ oncePerDay: false }))).toBe(false);
  });
});

// ── The strip's day window ───────────────────────────────────────────────────

describe('cycleDayKeys', () => {
  it('spans the logical week, anchored to Sunday', () => {
    vi.setSystemTime(localTime(2026, AUG, 12, 12));           // a Wednesday
    const days = cycleDayKeys(routine({ recurring: 'weekly', target: 3 }))!;
    expect(days).toEqual(['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']);
    expect(new Date(`${days[0]}T12:00:00`).getDay()).toBe(0);
  });

  it('runs an interval goal from its own reset', () => {
    vi.setSystemTime(localTime(2026, AUG, 12, 12));
    const days = cycleDayKeys(routine({ intervalDays: 3, target: 2, lastResetAt: localTime(2026, AUG, 11, 6).toISOString() }));
    expect(days).toEqual(['2026-08-11', '2026-08-12', '2026-08-13']);
  });

  it('declines a cycle too long to read as pips', () => {
    // Thirty of them is a heatmap, not a row — the counter stands alone there.
    expect(cycleDayKeys(routine({ recurring: 'monthly', target: 4 }))).toBeNull();
    expect(cycleDayKeys(routine({ intervalDays: 30, target: 4, lastResetAt: new Date().toISOString() }))).toBeNull();
  });

  it('labels days with the right initial', () => {
    expect(dayInitial('2026-08-09')).toBe('S');   // Sunday
    expect(dayInitial('2026-08-12')).toBe('W');
  });
});

// ── Logging days ─────────────────────────────────────────────────────────────

describe('toggleSession', () => {
  const seed = (over: Partial<Routine> = {}) => useQuestStore.setState({
    questlines: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    routines: [routine({ recurring: 'weekly', target: 3, lastResetAt: localTime(2026, AUG, 9, 6).toISOString(), ...over })],
  });
  const r = () => useQuestStore.getState().routines[0];

  it('logs a day at most once, however many times it is tapped', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    const toggle = () => useQuestStore.getState().toggleSession('r1', '2026-08-10');
    toggle(); expect(r().progress).toBe(1);
    toggle(); expect(r().progress).toBe(0);   // toggling, never accumulating
    toggle(); expect(r().progress).toBe(1);
    expect(r().sessionDays).toEqual(['2026-08-10']);
  });

  it('reaches the goal only across separate days', () => {
    seed();
    for (const day of [10, 12, 14]) {
      vi.setSystemTime(localTime(2026, AUG, day, 12));
      useQuestStore.getState().toggleSession('r1', `2026-08-${day}`);
    }
    expect(r().sessionDays).toEqual(['2026-08-10', '2026-08-12', '2026-08-14']);
    expect(r().progress).toBe(3);
    expect(r().completed).toBe(true);
  });

  it('stops the counter tapping a whole week into one afternoon', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().incrementRoutine('r1', 1);
    useQuestStore.getState().incrementRoutine('r1', 1);
    useQuestStore.getState().incrementRoutine('r1', 1);
    // ＋ means "I did it today", so the second and third presses are no-ops.
    expect(r().progress).toBe(1);
    expect(r().sessionDays).toEqual(['2026-08-10']);
  });

  it('lets the counter take today back', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().incrementRoutine('r1', 1);
    useQuestStore.getState().incrementRoutine('r1', -1);
    expect(r().progress).toBe(0);
    expect(r().sessionDays).toBeUndefined();
  });

  it('credits a backfilled day to that day, not to today', () => {
    vi.setSystemTime(localTime(2026, AUG, 13, 12));
    seed();
    // You went on Tuesday and forgot to log it.
    useQuestStore.getState().toggleSession('r1', '2026-08-11');
    expect(useQuestStore.getState().completionLog['2026-08-11']).toBe(1);
    expect(useQuestStore.getState().completionLog['2026-08-13'] ?? 0).toBe(0);
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-11']);
  });

  it('withdraws a backfill from the same day it credited', () => {
    vi.setSystemTime(localTime(2026, AUG, 13, 12));
    seed();
    useQuestStore.getState().toggleSession('r1', '2026-08-11');
    useQuestStore.getState().toggleSession('r1', '2026-08-11');
    expect(useQuestStore.getState().completionLog['2026-08-11']).toBe(0);
    expect(useQuestStore.getState().taskHistory['r1']).toBeUndefined();
  });

  it('refuses a day that has not happened yet', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().toggleSession('r1', '2026-08-14');
    expect(r().sessionDays).toBeUndefined();
  });

  it('allows an extra visit past the goal without over-counting', () => {
    vi.setSystemTime(localTime(2026, AUG, 14, 12));
    seed();
    for (const day of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']) {
      useQuestStore.getState().toggleSession('r1', day);
    }
    expect(r().sessionDays).toHaveLength(4);   // the strip shows all four
    expect(r().progress).toBe(3);              // progress stops at the goal
    expect(r().completed).toBe(true);
  });

  it('marks the row done for today only on a day actually logged', () => {
    vi.setSystemTime(localTime(2026, AUG, 13, 12));
    seed();
    useQuestStore.getState().toggleSession('r1', '2026-08-11');
    expect(sessionOn(r(), '2026-08-11')).toBe(true);
    expect(sessionOn(r(), '2026-08-13')).toBe(false);
  });

  it('starts the next cycle with an empty strip, keeping the history', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().toggleSession('r1', '2026-08-10');
    vi.setSystemTime(localTime(2026, AUG, 17, 12));           // weeks reset Sunday 5am
    useQuestStore.getState().checkAndResetRecurring();
    expect(r().sessionDays).toBeUndefined();
    expect(r().progress).toBe(0);
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-10']);
  });

  it('extends the streak when the week’s goal was met', () => {
    seed();
    for (const day of [10, 12, 14]) {
      vi.setSystemTime(localTime(2026, AUG, day, 12));
      useQuestStore.getState().toggleSession('r1', `2026-08-${day}`);
    }
    vi.setSystemTime(localTime(2026, AUG, 17, 12));
    useQuestStore.getState().checkAndResetRecurring();
    expect(r().streak).toBe(1);
  });

  it('does nothing to a task that is not counting days', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed({ target: 64, unit: 'oz' });
    useQuestStore.getState().toggleSession('r1', '2026-08-10');
    expect(r().sessionDays).toBeUndefined();
    expect(r().progress ?? 0).toBe(0);
  });
});

// ── The checkpoint ladder ────────────────────────────────────────────────────

describe('setRoutineProgress', () => {
  const seed = (over: Partial<Routine> = {}) => useQuestStore.setState({
    questlines: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    routines: [routine({ title: 'Drink water', recurring: 'daily', target: 64, step: 16, unit: 'oz', progress: 0, ...over })],
  });
  const r = () => useQuestStore.getState().routines[0];

  it('jumps straight to a checkpoint', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().setRoutineProgress('r1', 48);
    expect(r().progress).toBe(48);
    expect(r().completed).toBe(false);
  });

  it('completes at the top of the ladder', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().setRoutineProgress('r1', 64);
    expect(r().completed).toBe(true);
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(1);
  });

  it('clamps out-of-range values rather than trusting the caller', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().setRoutineProgress('r1', 500);
    expect(r().progress).toBe(64);
    useQuestStore.getState().setRoutineProgress('r1', -20);
    expect(r().progress).toBe(0);
    expect(r().completed).toBe(false);
  });

  it('withdraws the day when stepping back down', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed();
    useQuestStore.getState().setRoutineProgress('r1', 64);
    useQuestStore.getState().setRoutineProgress('r1', 32);
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(0);
  });

  it('refuses a session goal, whose unit is a day and not a dial', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seed({ recurring: 'weekly', target: 3, step: undefined, unit: undefined });
    useQuestStore.getState().setRoutineProgress('r1', 3);
    expect(r().progress ?? 0).toBe(0);
  });
});
