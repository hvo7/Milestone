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
import { showsOnDay, vynuesShowsOnDay, actionShowsOnDay, dueSummary, routineSettledOnDay, alwaysOnToday, onToday } from './today';
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

  it('keeps a weekly anchor habit up every day, counter or not', () => {
    const [k, s] = day();
    // The anchor group is the practice you singled out. A weekly one appearing
    // only on the day its week runs out is how you find out you missed it.
    const anchor = routine({ recurring: 'weekly', anchor: true, lastResetAt: localTime(2026, AUG, 9).toISOString() });
    expect(showsOnDay(anchor, k, s)).toBe(true);
    // …and the same task without the anchor flag still waits for its due day.
    expect(showsOnDay({ ...anchor, anchor: undefined }, k, s)).toBe(false);
  });

  it('leaves a system action off Today until it is pinned', () => {
    const [k, s] = day();
    // Belonging to a system is not by itself a reason to be on the day's list —
    // that's the pin's job, so the choice stays the user's.
    const action = routine({ recurring: 'weekly', systemId: 'sys-1', lastResetAt: localTime(2026, AUG, 9).toISOString() });
    expect(showsOnDay(action, k, s)).toBe(false);
    expect(showsOnDay({ ...action, trackedToday: true }, k, s)).toBe(true);
  });

  it('shows a daily system action without needing a pin', () => {
    const [k, s] = day();
    expect(showsOnDay(routine({ recurring: 'daily', systemId: 'sys-1' }), k, s)).toBe(true);
  });

  it('drops a finished anchor habit after its completion day', () => {
    const done = routine({
      recurring: 'weekly', anchor: true, completed: true,
      completedAt: localTime(2026, AUG, 10).toISOString(),
      lastResetAt: localTime(2026, AUG, 9).toISOString(),
    });
    const [k, s] = day();
    expect(showsOnDay(done, k, s)).toBe(true);
    const [nk, ns] = day(localTime(2026, AUG, 11));
    expect(showsOnDay(done, nk, ns)).toBe(false);
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
    // Filed under a questline: a due date is a plan, so it drives the list.
    const task = (dueDate: string) => routine({ questlineId: 'ql-1', dueDate });
    expect(showsOnDay(task('2026-08-12'), k, s)).toBe(false);
    expect(showsOnDay(task('2026-08-10'), k, s)).toBe(true);
    // Overdue stays up rather than quietly disappearing.
    expect(showsOnDay(task('2026-08-01'), k, s)).toBe(true);
  });

  /**
   * The General bucket is a list you work *from*, not a schedule. Its create
   * drawer defaults every task's due date to today, so "due today" said nothing
   * about whether you meant to do it today — and the day's list filled up with
   * car chores nobody had chosen for that day.
   */
  it('keeps a General one-off off Today until it is pinned there', () => {
    const [k, s] = day();
    expect(showsOnDay(routine({ dueDate: '2026-08-10' }), k, s)).toBe(false);
    expect(showsOnDay(routine(), k, s)).toBe(false);
    expect(showsOnDay(routine({ dueDate: '2026-08-10', trackedToday: true }), k, s)).toBe(true);
    // Pinned means today, whatever the date on it says.
    expect(showsOnDay(routine({ dueDate: '2026-12-25', trackedToday: true }), k, s)).toBe(true);
    // …and unpinning takes it straight back off.
    expect(showsOnDay(routine({ trackedToday: false, offToday: true }), k, s)).toBe(false);
  });

  it('still schedules a one-off that belongs to a questline or a system', () => {
    const [k, s] = day();
    expect(showsOnDay(routine({ questlineId: 'ql-1', dueDate: '2026-08-10' }), k, s)).toBe(true);
    expect(showsOnDay(routine({ systemIds: ['sys-1'], dueDate: '2026-08-10' }), k, s)).toBe(true);
    // The anchor rail is its own place on the page, and stays one.
    expect(showsOnDay(routine({ anchor: true, dueDate: '2026-08-10' }), k, s)).toBe(true);
  });

  it('lets a completed one-off linger only through the day it was finished', () => {
    const done = routine({ questlineId: 'ql-1', completed: true, completedAt: localTime(2026, AUG, 10).toISOString() });
    const [k, s] = day();
    expect(showsOnDay(done, k, s)).toBe(true);
    const [nk, ns] = day(localTime(2026, AUG, 11));
    expect(showsOnDay(done, nk, ns)).toBe(false);
  });

  it('lets a pinned General task linger the same way once ticked off', () => {
    const done = routine({ trackedToday: true, completed: true, completedAt: localTime(2026, AUG, 10).toISOString() });
    const [k, s] = day();
    expect(showsOnDay(done, k, s)).toBe(true);
    const [nk, ns] = day(localTime(2026, AUG, 11));
    expect(showsOnDay(done, nk, ns)).toBe(false);
  });
});

describe('the pin', () => {
  it('names why a task is on Today by default', () => {
    expect(alwaysOnToday(routine({ recurring: 'daily' }))).toBe('daily');
    expect(alwaysOnToday(routine({ recurring: 'weekly', anchor: true }))).toBe('anchor');
    expect(alwaysOnToday(routine({ recurring: 'weekly', target: 3 }))).toBe('goal');
    expect(alwaysOnToday(routine({ recurring: 'weekly' }))).toBeNull();
  });

  /**
   * The property the pin depends on, asserted against `showsOnDay` itself
   * rather than a restated rule: for *every* shape, taking it off Today has to
   * take it off Today. A control that offers to change something the list
   * ignores is the bug this exists to prevent.
   */
  it('can take any repeating task off Today, and put it back', () => {
    const shapes: Partial<Routine>[] = [
      { recurring: 'daily' },
      { recurring: 'weekly' },
      { recurring: 'monthly' },
      { recurring: 'weekly', anchor: true },
      { recurring: 'daily', anchor: true },
      { recurring: 'weekly', target: 3 },
      { recurring: 'weekly', subtasks: [{ id: 's', title: 'x', completed: false }] },
      { recurring: null, intervalDays: 3 },
    ];
    const [k, s] = day();
    for (const shape of shapes) {
      const base = routine({ ...shape, lastResetAt: localTime(2026, AUG, 9).toISOString() });
      const off = { ...base, trackedToday: false, offToday: true };
      const on  = { ...base, trackedToday: true,  offToday: undefined };
      expect({ shape, shown: showsOnDay(off, k, s) }).toEqual({ shape, shown: false });
      expect({ shape, shown: showsOnDay(on, k, s) }).toEqual({ shape, shown: true });
    }
  });

  it('reads its own state back', () => {
    expect(onToday(routine({ recurring: 'daily' }))).toBe(true);
    expect(onToday(routine({ recurring: 'daily', offToday: true }))).toBe(false);
    expect(onToday(routine({ recurring: 'weekly' }))).toBe(false);
    expect(onToday(routine({ recurring: 'weekly', trackedToday: true }))).toBe(true);
    // An explicit unpin beats a pin left over from before.
    expect(onToday(routine({ recurring: 'weekly', trackedToday: true, offToday: true }))).toBe(false);
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
