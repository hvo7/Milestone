/**
 * What lands on a day's list.
 *
 * These predicates decide whether a task you meant to do today is visible at all,
 * and a wrong answer looks exactly like "I forgot" rather than like a bug. The
 * reminder count is derived from the same functions on purpose — a nudge that
 * says "3 left" over a screen showing four is worse than no nudge, so the two
 * cannot be allowed to drift.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showsOnDay, vynuesShowsOnDay, actionShowsOnDay, dueSummary, routineSettledOnDay } from './today';
import { logicalDayStart, dateKey } from '../store';
import type { Routine, Action, Questline } from '../types';
import type { VynuesProject, VynuesTask } from '../vynuesStore';

const localTime = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h);
const AUG = 7;

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Task', recurring: null, completed: false, trackedToday: false, ...over,
});

const vTask = (over: Partial<VynuesTask> = {}): VynuesTask => ({
  id: 't1', title: 'T', done: false, priority: 'medium', createdAt: '', ...over,
});

/** The (dayKey, dayStart) pair every predicate here takes. */
const day = (d: Date = new Date()) => {
  const start = logicalDayStart(d);
  return [dateKey(start), start] as const;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(localTime(2026, AUG, 10));   // a Monday
});
afterEach(() => { vi.useRealTimers(); });

describe('showsOnDay', () => {
  it('always surfaces a daily task', () => {
    const [k, s] = day();
    expect(showsOnDay(routine({ recurring: 'daily' }), k, s)).toBe(true);
  });

  it('hides a weekly task until the day its period ends', () => {
    const [k, s] = day();
    const weekly = routine({ recurring: 'weekly', lastResetAt: localTime(2026, AUG, 9).toISOString() });
    expect(showsOnDay(weekly, k, s)).toBe(false);          // Monday
    const [sk, ss] = day(localTime(2026, AUG, 15));        // Saturday — week ends
    expect(showsOnDay(weekly, sk, ss)).toBe(true);
  });

  it('surfaces a pinned weekly task on any day', () => {
    const [k, s] = day();
    expect(showsOnDay(routine({ recurring: 'weekly', trackedToday: true, lastResetAt: localTime(2026, AUG, 9).toISOString() }), k, s)).toBe(true);
  });

  it('keeps a multi-day goal up every day while it is open', () => {
    const [k, s] = day();
    // A weekly counter is something you chip at, not something that appears once.
    const goal = routine({ recurring: 'weekly', target: 3, progress: 1, lastResetAt: localTime(2026, AUG, 9).toISOString() });
    expect(showsOnDay(goal, k, s)).toBe(true);
  });

  it('drops a finished multi-day goal after its completion day', () => {
    const goal = routine({
      recurring: 'weekly', target: 3, progress: 3, completed: true,
      completedAt: localTime(2026, AUG, 10).toISOString(),
      lastResetAt: localTime(2026, AUG, 9).toISOString(),
    });
    const [k, s] = day();
    expect(showsOnDay(goal, k, s)).toBe(true);
    const [nk, ns] = day(localTime(2026, AUG, 11));
    expect(showsOnDay(goal, nk, ns)).toBe(false);
  });

  it('holds a one-off back until its due date, then keeps it', () => {
    const [k, s] = day();
    expect(showsOnDay(routine({ dueDate: '2026-08-12' }), k, s)).toBe(false);
    expect(showsOnDay(routine({ dueDate: '2026-08-10' }), k, s)).toBe(true);
    // Overdue stays up rather than quietly disappearing.
    expect(showsOnDay(routine({ dueDate: '2026-08-01' }), k, s)).toBe(true);
  });

  it('lets a completed one-off linger only through the day it was finished', () => {
    const done = routine({ completed: true, completedAt: localTime(2026, AUG, 10).toISOString() });
    const [k, s] = day();
    expect(showsOnDay(done, k, s)).toBe(true);
    const [nk, ns] = day(localTime(2026, AUG, 11));
    expect(showsOnDay(done, nk, ns)).toBe(false);
  });
});

describe('vynuesShowsOnDay', () => {
  it('needs a due date or a pin for a one-off', () => {
    const [k, s] = day();
    expect(vynuesShowsOnDay(vTask(), k, s)).toBe(false);
    expect(vynuesShowsOnDay(vTask({ tracked: true }), k, s)).toBe(true);
    expect(vynuesShowsOnDay(vTask({ dueDate: '2026-08-10T09:00' }), k, s)).toBe(true);
  });

  it('reads a due date that carries a time of day', () => {
    const [k, s] = day();
    expect(vynuesShowsOnDay(vTask({ dueDate: '2026-08-11T09:00' }), k, s)).toBe(false);
  });
});

describe('actionShowsOnDay', () => {
  const action = (over: Partial<Action> = {}): Action => ({ id: 'a1', title: 'A', completed: false, ...over });

  it('shows a non-repeating action only when pinned', () => {
    const [, s] = day();
    expect(actionShowsOnDay(action(), s)).toBe(false);
    expect(actionShowsOnDay(action({ trackedToday: true }), s)).toBe(true);
  });

  it('never shows a hidden action, pinned or not', () => {
    const [, s] = day();
    expect(actionShowsOnDay(action({ trackedToday: true, hidden: true }), s)).toBe(false);
  });
});

describe('routineSettledOnDay', () => {
  it('treats a logged session as today done for a session goal', () => {
    const [k] = day();
    // A day-counting goal is settled by the day being *logged* — not by a
    // timestamp, which a backfill would put on the wrong day in both directions.
    const goal = routine({ recurring: 'weekly', target: 3, progress: 1, sessionDays: [k] });
    expect(goal.completed).toBe(false);
    expect(routineSettledOnDay(goal, k)).toBe(true);
  });

  it('is not settled on a day the session was not logged', () => {
    const [k] = day();
    const goal = routine({ recurring: 'weekly', target: 3, progress: 1, sessionDays: ['2026-08-09'] });
    expect(routineSettledOnDay(goal, k)).toBe(false);
  });

  it('treats progress as today done for a quantity goal', () => {
    const [k] = day();
    // A unit means quantity, so the last-progress timestamp is the right signal.
    const goal = routine({
      recurring: 'weekly', target: 64, unit: 'oz', progress: 16,
      lastProgressAt: localTime(2026, AUG, 10).toISOString(),
    });
    expect(routineSettledOnDay(goal, k)).toBe(true);
  });

  it('does not count a skipped day as done', () => {
    const [k] = day();
    const goal = routine({ recurring: 'weekly', target: 3, progress: 1, sessionDays: [k], skippedOn: k });
    expect(routineSettledOnDay(goal, k)).toBe(false);
  });
});

describe('dueSummary', () => {
  const questline = (over: Partial<Questline> = {}): Questline => ({
    id: 'ql', title: 'QL', description: '', icon: '', color: 'amber', quests: [], ...over,
  });
  const project = (tasks: VynuesTask[], status: VynuesProject['status'] = 'active'): VynuesProject =>
    ({ id: 'p1', name: 'P', description: '', color: 'amber', status, createdAt: '', tasks });

  it('counts across every source', () => {
    const s = dueSummary(
      {
        routines: [routine({ id: 'r1', recurring: 'daily' }), routine({ id: 'r2', recurring: 'daily', completed: true })],
        questlines: [questline({ quests: [{
          id: 'q1', title: 'Q', description: '', order: 1,
          actions: [{ id: 'a1', title: 'A', completed: false, recurring: 'daily' }],
        }] })],
      },
      { projects: [project([vTask({ tracked: true })])] },
    );
    expect(s.total).toBe(4);
    expect(s.open).toBe(3);
    expect(s.openTitles).toEqual(['Task', 'A', 'T']);
  });

  it('counts a pinned quest once and not its actions', () => {
    const s = dueSummary(
      { routines: [], questlines: [questline({ quests: [{
        id: 'q1', title: 'Pinned', description: '', order: 1, trackedToday: true,
        actions: [
          { id: 'a1', title: 'A', completed: false, recurring: 'daily' },
          { id: 'a2', title: 'B', completed: false, recurring: 'daily' },
        ],
      }] })] },
      { projects: [] },
    );
    expect(s.total).toBe(1);
    expect(s.openTitles).toEqual(['Pinned']);
  });

  it('ignores skipped and hidden tasks entirely', () => {
    const [k] = day();
    const s = dueSummary(
      { routines: [
        routine({ id: 'r1', recurring: 'daily', skippedOn: k }),
        routine({ id: 'r2', recurring: 'daily', hidden: true }),
        routine({ id: 'r3', title: 'Real', recurring: 'daily' }),
      ], questlines: [] },
      { projects: [] },
    );
    // A skip is an explicit "not today" — nagging about it defeats the point.
    expect(s.total).toBe(1);
    expect(s.openTitles).toEqual(['Real']);
  });

  it('leaves out a paused project unless the task is pinned', () => {
    const paused = (tasks: VynuesTask[]) => project(tasks, 'paused');
    expect(dueSummary({ routines: [], questlines: [] }, { projects: [paused([vTask({ tracked: false, dueDate: '2026-08-10' })])] }).total).toBe(0);
    expect(dueSummary({ routines: [], questlines: [] }, { projects: [paused([vTask({ tracked: true })])] }).total).toBe(1);
  });
});
