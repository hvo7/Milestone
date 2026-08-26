/**
 * System health.
 *
 * The point of these is that the number stays fair. A process metric that
 * punishes you for adding a habit late, or that reads 100% off two days of
 * data, would push exactly the behaviour the tab exists to discourage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cycleDays, repsPerCycle, habitHealth, systemHealth, systemRoutines,
  orderedSystems, missState, habitTrend, systemTrend, HEALTH_WINDOW_DAYS,
} from './systems';
import type { Routine, System } from '../types';

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Habit', recurring: 'daily', completed: false, trackedToday: false, ...over,
});

/** `n` consecutive day keys ending on 2026-08-10. */
const daysEnding = (n: number, end = new Date(2026, 7, 10, 12)): string[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(end.getTime() - i * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }).reverse();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 10, 12)); });
afterEach(() => { vi.useRealTimers(); });

describe('cadence arithmetic', () => {
  it('knows how long a cycle is', () => {
    expect(cycleDays(routine({ recurring: 'daily' }))).toBe(1);
    expect(cycleDays(routine({ recurring: 'weekly' }))).toBe(7);
    expect(cycleDays(routine({ recurring: 'monthly' }))).toBe(30);
    expect(cycleDays(routine({ recurring: null, intervalDays: 3 }))).toBe(3);
    expect(cycleDays(routine({ recurring: null }))).toBe(0);   // one-off
  });

  it('counts a session goal as several days per cycle', () => {
    // "Gym 3× a week" asks for three days, not one.
    expect(repsPerCycle(routine({ recurring: 'weekly', target: 3 }))).toBe(3);
    // A quantity counter is still one day's work, however many taps it takes.
    expect(repsPerCycle(routine({ recurring: 'weekly', target: 64, unit: 'oz' }))).toBe(1);
    expect(repsPerCycle(routine({ recurring: 'daily' }))).toBe(1);
  });
});

describe('habitHealth', () => {
  const history = (days: string[]) => ({ r1: days });

  it('scores a daily habit against the full window', () => {
    const h = habitHealth(routine({ createdAt: new Date(2026, 0, 1).toISOString() }), history(daysEnding(15)))!;
    expect(h.days).toBe(HEALTH_WINDOW_DAYS);
    expect(h.expected).toBe(30);
    expect(h.done).toBe(15);
    expect(h.rate).toBeCloseTo(0.5);
  });

  it('scores a weekly session goal against its three-a-week ask', () => {
    const gym = routine({ recurring: 'weekly', target: 3, createdAt: new Date(2026, 0, 1).toISOString() });
    const h = habitHealth(gym, history(daysEnding(13)))!;
    expect(h.expected).toBe(13);      // round(3 × 30 ÷ 7)
    expect(h.rate).toBe(1);
  });

  it('never exceeds 100%', () => {
    const h = habitHealth(routine({ recurring: 'weekly', createdAt: new Date(2026, 0, 1).toISOString() }), history(daysEnding(30)))!;
    expect(h.rate).toBe(1);
  });

  it('does not score a habit over days it did not exist for', () => {
    // Created five days ago, run on four of them. Against the full window that
    // would read 13%; against its actual life it's most of the way there.
    const young = routine({ createdAt: new Date(2026, 7, 6, 9).toISOString() });
    const h = habitHealth(young, history(daysEnding(4)))!;
    expect(h.days).toBe(5);
    expect(h.expected).toBe(5);
    expect(h.rate).toBeCloseTo(0.8);
  });

  it('falls back to the first recorded day when there is no createdAt', () => {
    const h = habitHealth(routine(), history(daysEnding(3)))!;
    expect(h.days).toBe(3);
  });

  it('scores a two-day-old habit against its two days', () => {
    // No "settling" caveat any more: the window simply clips to the habit's age,
    // so 2 of 2 is 100% and says so.
    const h = habitHealth(routine({ createdAt: new Date(2026, 7, 9, 9).toISOString() }), history(daysEnding(2)))!;
    expect(h.rate).toBe(1);
    expect(h.days).toBe(2);
  });

  it('ignores days outside the window', () => {
    const old = ['2026-01-01', '2026-02-01'];
    const h = habitHealth(routine({ createdAt: new Date(2026, 0, 1).toISOString() }), history([...old, ...daysEnding(3)]))!;
    expect(h.done).toBe(3);
  });

  it('has no opinion about a one-off', () => {
    expect(habitHealth(routine({ recurring: null }), history(daysEnding(3)))).toBeNull();
  });

  it('survives a habit with no history at all', () => {
    const h = habitHealth(routine({ createdAt: new Date(2026, 0, 1).toISOString() }), {})!;
    expect(h.done).toBe(0);
    expect(h.rate).toBe(0);
  });
});

describe('systemHealth', () => {
  const two = [routine({ id: 'a' }), routine({ id: 'b' })];
  const hist = { a: daysEnding(30), b: daysEnding(15) };

  it('averages its habits rather than demanding all of them', () => {
    // 100% and 50% is a system that is working at 75%, not one that has failed.
    const h = systemHealth(two.map(r => ({ ...r, createdAt: new Date(2026, 0, 1).toISOString() })), hist);
    expect(h.rate).toBeCloseTo(0.75);
    expect(h.scored).toBe(2);
  });

  it('leaves one-offs out instead of scoring them zero', () => {
    const mixed = [
      { ...routine({ id: 'a' }), createdAt: new Date(2026, 0, 1).toISOString() },
      routine({ id: 'c', recurring: null }),
    ];
    const h = systemHealth(mixed, hist);
    expect(h.scored).toBe(1);
    expect(h.total).toBe(2);
    expect(h.rate).toBe(1);
  });

  it('reports nothing scorable rather than zero', () => {
    const h = systemHealth([], {});
    expect(h.rate).toBeNull();
    expect(h.bestStreak).toBe(0);
  });

  it('surfaces the best live streak', () => {
    const h = systemHealth([routine({ id: 'a', streak: 3 }), routine({ id: 'b', streak: 11 })], hist);
    expect(h.bestStreak).toBe(11);
  });
});

describe('never miss twice', () => {
  // 2026-08-10 is "today"; day 1 is the 9th, day 2 the 8th.
  const day = (n: number) => daysEnding(n + 1)[0];

  it('is fine while yesterday was run', () => {
    expect(missState(routine(), { r1: [day(1)] })).toBe('ok');
  });

  it('is fine on a day already run', () => {
    expect(missState(routine(), { r1: [day(0)] })).toBe('ok');
  });

  it('warns on the day after a single miss', () => {
    // Ran the 8th, missed the 9th — today is the one that matters.
    expect(missState(routine(), { r1: [day(2)] })).toBe('at-risk');
  });

  it('calls two misses what they are', () => {
    expect(missState(routine(), { r1: [day(3)] })).toBe('broken');
  });

  it('treats a habit that never ran as broken, not at risk', () => {
    expect(missState(routine(), {})).toBe('broken');
  });

  it('says nothing about a weekly habit', () => {
    // "Twice" has no obvious meaning for a weekly cadence.
    expect(missState(routine({ recurring: 'weekly' }), { r1: [] })).toBeNull();
    expect(missState(routine({ recurring: 'daily', intervalDays: 3 }), { r1: [] })).toBeNull();
  });
});

describe('trend', () => {
  const old = new Date(2026, 0, 1).toISOString();

  it('is positive when the last week beat the one before', () => {
    // 6 of the last 7, 2 of the 7 before.
    const recent = daysEnding(7).slice(0, 6);
    const prior  = daysEnding(14).slice(0, 2);
    const t = habitTrend(routine({ createdAt: old }), { r1: [...prior, ...recent] })!;
    expect(t.delta).toBeGreaterThan(0);
    expect(t.meaningful).toBe(true);
  });

  it('is negative when it slipped', () => {
    const prior = daysEnding(14).slice(0, 7);
    const t = habitTrend(routine({ createdAt: old }), { r1: prior })!;
    expect(t.delta).toBeLessThan(0);
  });

  it('is flat when nothing changed', () => {
    const t = habitTrend(routine({ createdAt: old }), { r1: daysEnding(14) })!;
    expect(t.delta).toBe(0);
  });

  it('refuses to draw a conclusion from a young habit', () => {
    const t = habitTrend(routine({ createdAt: new Date(2026, 7, 8).toISOString() }), { r1: daysEnding(2) })!;
    expect(t.meaningful).toBe(false);
  });

  it('has no opinion about a one-off', () => {
    expect(habitTrend(routine({ recurring: null }), { r1: [] })).toBeNull();
  });

  it('averages across a system', () => {
    const rs = [routine({ id: 'a', createdAt: old }), routine({ id: 'b', createdAt: old })];
    const t = systemTrend(rs, { a: daysEnding(7).slice(0, 7), b: [] })!;
    expect(t.delta).toBeGreaterThan(0);
  });
});

describe('presentation helpers', () => {
  it('picks out a system’s habits and skips hidden ones', () => {
    const rs = [
      routine({ id: 'a', systemId: 's1' }),
      routine({ id: 'b', systemId: 's2' }),
      routine({ id: 'c', systemId: 's1', hidden: true }),
    ];
    expect(systemRoutines(rs, 's1').map(r => r.id)).toEqual(['a']);
  });

  it('orders systems and drops hidden ones', () => {
    const ss: System[] = [
      { id: '2', title: 'B', order: 1 },
      { id: '1', title: 'A', order: 0 },
      { id: '3', title: 'C', order: 2, hidden: true },
    ];
    expect(orderedSystems(ss).map(s => s.title)).toEqual(['A', 'B']);
  });
});
