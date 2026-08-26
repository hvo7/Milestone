/**
 * Streaks: what breaks one, what doesn't, and setting one by hand.
 *
 * The counter is a record of a practice, not a score the app defends against
 * you. It can only count what it saw — days before the task existed, or a
 * stretch the app was never opened for — so the number has to be editable, and
 * an edited number has to behave exactly like an earned one from then on.
 *
 * The skip cases are here because the behaviour was reported as broken; they
 * pin it either way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useQuestStore } from './store';
import type { Routine } from './types';

const at = (d: number, h = 12) => new Date(2026, 7, d, h);

const seed = (over: Partial<Routine> = {}) => useQuestStore.setState({
  routines: [{
    id: 'r1', title: 'Read', recurring: 'daily', completed: false, trackedToday: true,
    anchor: true, streak: 7, lastResetAt: at(10, 6).toISOString(), ...over,
  }],
  questlines: [], completionLog: {}, taskHistory: {},
} as never);

const r = () => useQuestStore.getState().routines[0];
const roll = (toDay: number) => { vi.setSystemTime(at(toDay)); useQuestStore.getState().checkAndResetRecurring(); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(at(10)); seed(); });
afterEach(() => { vi.useRealTimers(); });

describe('a skip is neutral', () => {
  it('keeps the streak across the rollover', () => {
    useQuestStore.getState().skipRoutine('r1');
    roll(11);
    expect(r().streak).toBe(7);
  });

  it('an ordinary miss still breaks it', () => {
    roll(11);
    expect(r().streak).toBe(0);
  });

  it('two skipped days running still keep it', () => {
    useQuestStore.getState().skipRoutine('r1');
    roll(11);
    useQuestStore.getState().skipRoutine('r1');
    roll(12);
    expect(r().streak).toBe(7);
  });
});

describe('setting a streak by hand', () => {
  it('stores the number given', () => {
    useQuestStore.getState().updateRoutine('r1', { streak: 42 });
    expect(r().streak).toBe(42);
  });

  it('refuses a negative and floors a fraction', () => {
    useQuestStore.getState().updateRoutine('r1', { streak: -5 });
    expect(r().streak).toBe(0);
    useQuestStore.getState().updateRoutine('r1', { streak: 3.9 });
    expect(r().streak).toBe(3);
  });

  it('leaves the streak alone when the field is not sent', () => {
    useQuestStore.getState().updateRoutine('r1', { title: 'Read more' });
    expect(r().streak).toBe(7);
  });

  it('carries on counting from the number you set', () => {
    useQuestStore.getState().updateRoutine('r1', { streak: 100 });
    useQuestStore.getState().toggleRoutine('r1');   // done today
    roll(11);
    expect(r().streak).toBe(101);
  });

  it('wins over the cadence reset when both change in one save', () => {
    // Changing the schedule restarts the clock and preserves the old streak; an
    // explicit streak in the same save has to be the one that lands.
    useQuestStore.getState().updateRoutine('r1', { recurring: 'weekly', streak: 12 });
    expect(r().recurring).toBe('weekly');
    expect(r().streak).toBe(12);
  });
});
