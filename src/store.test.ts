/**
 * The recurrence/reset engine and the completion log.
 *
 * These are the rules a user experiences as "my streak is wrong" or "that task
 * came back a day early" — failures that are invisible in review and obvious in
 * use. Times are pinned with fake timers throughout, because every one of these
 * answers depends on what "today" is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useQuestStore, DAY_RESET_HOUR,
  logicalDayStart, logicalDateKey, dateKey,
  periodExpired, dueOnDay, skipActive, repeats, sameRule,
  isMultiDayCycle, isGoalRoutine, isQuestComplete, isQuestUnlocked,
  questProgress, subtaskStats, isArchivedRoutine, recurrenceLabel,
} from './store';
import type { Questline, Routine, Quest } from './types';

/** Local wall-clock instant, so tests read as the times a user would see. */
const localTime = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min);

const AUG = 7;

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Task', recurring: null, completed: false, trackedToday: false, ...over,
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ── Logical day (the 5am rollover) ───────────────────────────────────────────

describe('logical day', () => {
  it('counts the small hours as the previous day', () => {
    // 2am on the 10th is still "the 9th" — work done after midnight belongs to
    // the day that just ended, not the one starting.
    vi.setSystemTime(localTime(2026, AUG, 10, 2));
    expect(logicalDateKey()).toBe('2026-08-09');
  });

  it('rolls over at the reset hour', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, DAY_RESET_HOUR, 1));
    expect(logicalDateKey()).toBe('2026-08-10');
  });

  it('starts the logical day at midnight of that day', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 2));
    const start = logicalDayStart();
    expect(dateKey(start)).toBe('2026-08-09');
    expect(start.getHours()).toBe(0);
  });
});

// ── periodExpired ────────────────────────────────────────────────────────────

describe('periodExpired', () => {
  it('is false without a reset stamp', () => {
    vi.setSystemTime(localTime(2026, AUG, 10));
    expect(periodExpired({ recurring: 'daily' })).toBe(false);
  });

  it('expires a daily task on the next logical day', () => {
    const lastResetAt = localTime(2026, AUG, 9, 12).toISOString();
    vi.setSystemTime(localTime(2026, AUG, 10, 2));   // still logically the 9th
    expect(periodExpired({ recurring: 'daily', lastResetAt })).toBe(false);
    vi.setSystemTime(localTime(2026, AUG, 10, 6));   // now the 10th
    expect(periodExpired({ recurring: 'daily', lastResetAt })).toBe(true);
  });

  it('expires a weekly task once the week turns over on Sunday', () => {
    // 9 Aug 2026 is a Sunday; a task reset the previous Wednesday is stale.
    expect(localTime(2026, AUG, 9).getDay()).toBe(0);
    const lastResetAt = localTime(2026, AUG, 5, 12).toISOString();
    vi.setSystemTime(localTime(2026, AUG, 8, 12));   // Saturday — same week
    expect(periodExpired({ recurring: 'weekly', lastResetAt })).toBe(false);
    vi.setSystemTime(localTime(2026, AUG, 10, 12));  // past Sunday's rollover
    expect(periodExpired({ recurring: 'weekly', lastResetAt })).toBe(true);
  });

  it('measures a custom interval in whole logical days', () => {
    const lastResetAt = localTime(2026, AUG, 1, 23).toISOString();
    const every3 = { recurring: 'daily' as const, intervalDays: 3, lastResetAt };
    vi.setSystemTime(localTime(2026, AUG, 3, 12));
    expect(periodExpired(every3)).toBe(false);
    vi.setSystemTime(localTime(2026, AUG, 4, 12));
    expect(periodExpired(every3)).toBe(true);
  });

  it('lets a calendar rule outrank the base cadence', () => {
    // First Monday of Aug 2026 is the 3rd. Reset on the 1st, so by the 4th the
    // occurrence has passed and the cycle has turned.
    const rule = { nth: 1 as const, kind: 'mon' as const };
    const sched = { recurring: 'monthly' as const, monthlyRule: rule, lastResetAt: localTime(2026, AUG, 1).toISOString() };
    vi.setSystemTime(localTime(2026, AUG, 2, 12));
    expect(periodExpired(sched)).toBe(false);
    vi.setSystemTime(localTime(2026, AUG, 4, 12));
    expect(periodExpired(sched)).toBe(true);
  });
});

// ── dueOnDay ─────────────────────────────────────────────────────────────────

describe('dueOnDay', () => {
  it('makes a daily task due every day', () => {
    expect(dueOnDay({ recurring: 'daily' }, localTime(2026, AUG, 10, 0))).toBe(true);
  });

  it('makes a weekly task due only on the last day of the logical week', () => {
    // Weeks reset Sunday, so Saturday is the closing day.
    expect(dueOnDay({ recurring: 'weekly' }, localTime(2026, AUG, 8, 0))).toBe(true);  // Saturday
    expect(dueOnDay({ recurring: 'weekly' }, localTime(2026, AUG, 5, 0))).toBe(false); // Wednesday
  });

  it('is not due when an interval has no reset stamp yet', () => {
    expect(dueOnDay({ recurring: 'daily', intervalDays: 5 }, localTime(2026, AUG, 10, 0))).toBe(false);
  });
});

// ── Skips ────────────────────────────────────────────────────────────────────

describe('skipActive', () => {
  it('excuses only the day it was made', () => {
    const r = routine({ recurring: 'daily', skippedOn: '2026-08-10' });
    expect(skipActive(r, '2026-08-10')).toBe(true);
    expect(skipActive(r, '2026-08-11')).toBe(false);
  });
});

// ── Shape predicates ─────────────────────────────────────────────────────────

describe('cycle shape', () => {
  it('recognises anything that repeats', () => {
    expect(repeats({ recurring: 'daily' })).toBe(true);
    expect(repeats({ intervalDays: 3 })).toBe(true);
    expect(repeats({ monthlyRule: { nth: 1, kind: 'mon' } })).toBe(true);
    expect(repeats({})).toBe(false);
  });

  it('treats a calendar rule as a single-day task, not a span', () => {
    // "First Monday" names one date; it isn't a week you chip away at.
    expect(isMultiDayCycle({ recurring: 'monthly', monthlyRule: { nth: 1, kind: 'mon' } })).toBe(false);
    expect(isMultiDayCycle({ recurring: 'weekly' })).toBe(true);
    expect(isMultiDayCycle({ recurring: 'daily' })).toBe(false);
    expect(isMultiDayCycle({ recurring: 'daily', intervalDays: 1 })).toBe(false);
    expect(isMultiDayCycle({ recurring: 'daily', intervalDays: 4 })).toBe(true);
  });

  it('counts a multi-day task as a goal only with a target or steps', () => {
    expect(isGoalRoutine(routine({ recurring: 'weekly' }))).toBe(false);
    expect(isGoalRoutine(routine({ recurring: 'weekly', target: 3 }))).toBe(true);
    expect(isGoalRoutine(routine({ recurring: 'weekly', subtasks: [{ id: 's', title: 'x', completed: false }] }))).toBe(true);
    // Daily tasks are never goals however they're configured.
    expect(isGoalRoutine(routine({ recurring: 'daily', target: 3 }))).toBe(false);
  });

  it('compares calendar rules by identity, including the anchor', () => {
    expect(sameRule({ nth: 1, kind: 'mon' }, { nth: 1, kind: 'mon' })).toBe(true);
    expect(sameRule({ nth: 1, kind: 'mon' }, { nth: 2, kind: 'mon' })).toBe(false);
    expect(sameRule({ nth: 1, kind: 'mon', months: 2, anchorMonth: 5 }, { nth: 1, kind: 'mon', months: 2, anchorMonth: 6 })).toBe(false);
    expect(sameRule(null, undefined)).toBe(true);
    // An absent `months` means 1, so these are the same schedule.
    expect(sameRule({ nth: 1, kind: 'mon' }, { nth: 1, kind: 'mon', months: 1 })).toBe(true);
  });
});

// ── Quests ───────────────────────────────────────────────────────────────────

const quest = (over: Partial<Quest> = {}): Quest =>
  ({ id: 'q1', title: 'Q', description: '', order: 1, actions: [], ...over });

describe('quest completion', () => {
  it('derives completion from visible actions', () => {
    expect(isQuestComplete(quest({ actions: [
      { id: 'a', title: 'a', completed: true },
      { id: 'b', title: 'b', completed: false },
    ] }))).toBe(false);
    expect(isQuestComplete(quest({ actions: [
      { id: 'a', title: 'a', completed: true },
      { id: 'b', title: 'b', completed: false, hidden: true },
    ] }))).toBe(true);
  });

  it('falls back to its own flag when it has no actions', () => {
    expect(isQuestComplete(quest({ completed: true }))).toBe(true);
    expect(isQuestComplete(quest())).toBe(false);
  });

  it('ignores hidden actions in progress', () => {
    const p = questProgress(quest({ actions: [
      { id: 'a', title: 'a', completed: true },
      { id: 'b', title: 'b', completed: false },
      { id: 'c', title: 'c', completed: false, hidden: true },
    ] }));
    expect(p).toEqual({ done: 1, total: 2 });
  });

  it('gates a sequential questline on the previous quest', () => {
    const ql: Questline = {
      id: 'ql', title: '', description: '', icon: '', color: 'amber', sequential: true,
      quests: [
        quest({ id: 'q1', order: 1, actions: [{ id: 'a', title: 'a', completed: false }] }),
        quest({ id: 'q2', order: 2 }),
      ],
    };
    expect(isQuestUnlocked(ql, ql.quests[0])).toBe(true);
    expect(isQuestUnlocked(ql, ql.quests[1])).toBe(false);
    ql.quests[0].actions[0].completed = true;
    expect(isQuestUnlocked(ql, ql.quests[1])).toBe(true);
  });

  it('leaves a non-sequential questline fully unlocked', () => {
    const ql: Questline = {
      id: 'ql', title: '', description: '', icon: '', color: 'amber',
      quests: [quest({ id: 'q1', order: 1 }), quest({ id: 'q2', order: 2 })],
    };
    expect(isQuestUnlocked(ql, ql.quests[1])).toBe(true);
  });
});

describe('subtaskStats', () => {
  it('counts every nested level', () => {
    expect(subtaskStats([
      { id: '1', title: 'a', completed: true, children: [
        { id: '2', title: 'b', completed: false },
        { id: '3', title: 'c', completed: true, children: [{ id: '4', title: 'd', completed: true }] },
      ] },
    ])).toEqual({ done: 3, total: 4 });
  });
});

describe('isArchivedRoutine', () => {
  it('archives a general one-off the day after completion', () => {
    const r = routine({ completed: true, completedAt: localTime(2026, AUG, 9, 12).toISOString() });
    expect(isArchivedRoutine(r, '2026-08-09')).toBe(false);  // still its own day
    expect(isArchivedRoutine(r, '2026-08-10')).toBe(true);
  });

  it('never archives recurring, questline or anchor tasks', () => {
    const done = { completed: true, completedAt: localTime(2026, AUG, 9).toISOString() };
    expect(isArchivedRoutine(routine({ ...done, recurring: 'daily' }), '2026-08-11')).toBe(false);
    expect(isArchivedRoutine(routine({ ...done, questlineId: 'ql' }), '2026-08-11')).toBe(false);
    expect(isArchivedRoutine(routine({ ...done, anchor: true }), '2026-08-11')).toBe(false);
  });
});

describe('recurrenceLabel', () => {
  it('prefers the most specific description', () => {
    expect(recurrenceLabel({ monthlyRule: { nth: 1, kind: 'mon' } })).toBe('1st Mon');
    expect(recurrenceLabel({ recurring: 'daily', intervalDays: 21 })).toBe('Every 3 weeks');
    expect(recurrenceLabel({ recurring: 'daily', intervalDays: 60 })).toBe('Every 2 months');
    expect(recurrenceLabel({ recurring: 'weekly' })).toBe('Weekly');
    expect(recurrenceLabel({})).toBe('Once');
  });
});

// ── Completion log ───────────────────────────────────────────────────────────
// The regression guard for a real bug: un-crediting used to always target
// *today*, so unchecking yesterday's work silently ate a square from today and
// left yesterday credited for work that no longer existed.

describe('completion log day attribution', () => {
  const seed = () => useQuestStore.setState({
    questlines: [{
      id: 'ql', title: 'QL', description: '', icon: '', color: 'amber',
      quests: [{
        id: 'q1', title: 'Q', description: '', order: 1,
        actions: [
          { id: 'a1', title: 'One', completed: false },
          { id: 'a2', title: 'Two', completed: false },
        ],
      }],
    }],
    routines: [],
    completionLog: {},
    todoOrder: {},
  });

  it('credits the day an action was checked', () => {
    seed();
    vi.setSystemTime(localTime(2026, AUG, 9, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');
    expect(useQuestStore.getState().completionLog['2026-08-09']).toBe(1);
  });

  it('un-credits the original day, not today', () => {
    seed();
    vi.setSystemTime(localTime(2026, AUG, 9, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');

    // Next day: change your mind about yesterday's work.
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');

    const log = useQuestStore.getState().completionLog;
    expect(log['2026-08-09']).toBe(0);          // the day that actually loses it
    expect(log['2026-08-10'] ?? 0).toBe(0);     // today must be untouched
  });

  it('stamps and clears completedAt alongside the flag', () => {
    seed();
    vi.setSystemTime(localTime(2026, AUG, 9, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');
    const on = useQuestStore.getState().questlines[0].quests[0].actions[0];
    expect(on.completed).toBe(true);
    expect(on.completedAt).toBeTruthy();

    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');
    const off = useQuestStore.getState().questlines[0].quests[0].actions[0];
    expect(off.completed).toBe(false);
    expect(off.completedAt).toBeUndefined();
  });

  it('moves each action to its own day when a whole quest is reopened', () => {
    seed();
    vi.setSystemTime(localTime(2026, AUG, 8, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');   // credited to the 8th
    vi.setSystemTime(localTime(2026, AUG, 9, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a2');   // credited to the 9th
    expect(useQuestStore.getState().completionLog).toMatchObject({ '2026-08-09': 1 });

    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().setQuestComplete('ql', 'q1', false);

    const log = useQuestStore.getState().completionLog;
    expect(log['2026-08-08']).toBe(0);
    expect(log['2026-08-09']).toBe(0);
    expect(log['2026-08-10'] ?? 0).toBe(0);
  });

  it('credits today when completing a whole quest, once per action', () => {
    seed();
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().setQuestComplete('ql', 'q1', true);
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(2);
  });

  it('never drives a day negative', () => {
    seed();
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    // An action completed before completedAt existed: unchecking falls back to
    // today, which has no credit to give.
    useQuestStore.setState({
      questlines: [{
        id: 'ql', title: 'QL', description: '', icon: '', color: 'amber',
        quests: [{ id: 'q1', title: 'Q', description: '', order: 1,
          actions: [{ id: 'a1', title: 'One', completed: true }] }],
      }],
    });
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(0);
  });
});

// ── Recurring resets and streaks ─────────────────────────────────────────────

describe('checkAndResetRecurring', () => {
  const withRoutine = (r: Routine) => useQuestStore.setState({
    questlines: [], routines: [r], completionLog: {}, todoOrder: {},
  });

  it('extends the streak when the cycle closed complete', () => {
    withRoutine(routine({
      recurring: 'daily', completed: true, streak: 4,
      lastResetAt: localTime(2026, AUG, 9, 12).toISOString(),
    }));
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().checkAndResetRecurring();
    const r = useQuestStore.getState().routines[0];
    expect(r.streak).toBe(5);
    expect(r.completed).toBe(false);
  });

  it('breaks the streak on a plain miss', () => {
    withRoutine(routine({
      recurring: 'daily', completed: false, streak: 4,
      lastResetAt: localTime(2026, AUG, 9, 12).toISOString(),
    }));
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().checkAndResetRecurring();
    expect(useQuestStore.getState().routines[0].streak).toBe(0);
  });

  it('preserves the streak across a skipped day', () => {
    // A skip is neutral: neither extended nor broken. This is the whole point of
    // skipping rather than just not doing it.
    withRoutine(routine({
      recurring: 'daily', completed: false, streak: 4, skippedOn: '2026-08-09',
      lastResetAt: localTime(2026, AUG, 9, 12).toISOString(),
    }));
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().checkAndResetRecurring();
    const r = useQuestStore.getState().routines[0];
    expect(r.streak).toBe(4);
    expect(r.skippedOn).toBeUndefined();
  });

  it('empties a counter at the start of a new cycle', () => {
    withRoutine(routine({
      recurring: 'weekly', target: 3, progress: 2, streak: 0,
      lastResetAt: localTime(2026, AUG, 1, 12).toISOString(),
    }));
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().checkAndResetRecurring();
    expect(useQuestStore.getState().routines[0].progress).toBe(0);
  });

  it('retires a skip whose day has passed without resetting the cycle', () => {
    withRoutine(routine({
      recurring: 'weekly', skippedOn: '2026-08-09', streak: 2,
      lastResetAt: localTime(2026, AUG, 9, 12).toISOString(),
    }));
    vi.setSystemTime(localTime(2026, AUG, 10, 12));   // same week, next day
    useQuestStore.getState().checkAndResetRecurring();
    const r = useQuestStore.getState().routines[0];
    expect(r.skippedOn).toBeUndefined();
    expect(r.streak).toBe(2);
  });
});

// ── Counters ─────────────────────────────────────────────────────────────────

describe('incrementRoutine', () => {
  // A *quantity* counter — 3 litres, not 3 gym visits. The unit is what tells
  // the two apart: a multi-day count with no unit is counting occurrences and
  // goes through sessions instead, where a day can only be logged once (see
  // store.sessions.test.ts). Without the unit here these would be exercising
  // that mode rather than this one.
  beforeEach(() => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.setState({
      questlines: [], completionLog: {}, taskHistory: {}, todoOrder: {},
      routines: [routine({ recurring: 'weekly', target: 3, progress: 0, unit: 'L' })],
    });
  });

  it('completes once the target is reached and clamps there', () => {
    useQuestStore.getState().incrementRoutine('r1', 2);
    expect(useQuestStore.getState().routines[0].completed).toBe(false);
    useQuestStore.getState().incrementRoutine('r1', 5);
    const r = useQuestStore.getState().routines[0];
    expect(r.progress).toBe(3);
    expect(r.completed).toBe(true);
  });

  it('never goes below zero', () => {
    useQuestStore.getState().incrementRoutine('r1', -5);
    expect(useQuestStore.getState().routines[0].progress).toBe(0);
  });

  it('counts a multi-day goal only once per day in the heatmap', () => {
    // Three top-ups logged on one day is still one day of credit.
    useQuestStore.getState().incrementRoutine('r1', 1);
    useQuestStore.getState().incrementRoutine('r1', 1);
    useQuestStore.getState().incrementRoutine('r1', 1);
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(1);
  });
});

// ── Per-task history ─────────────────────────────────────────────────────────
// The aggregate completionLog can say "three things on Tuesday" but never which
// three, so it can never answer the question that changes behaviour: which habit
// have I been quietly failing? These record that going forward — and must stay in
// lockstep with the log, since two counters that can disagree eventually will.

describe('taskHistory', () => {
  const seedRoutine = (over: Partial<Routine> = {}) => useQuestStore.setState({
    questlines: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    routines: [routine({ recurring: 'daily', ...over })],
  });

  it('records the day a task was completed on', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seedRoutine();
    useQuestStore.getState().toggleRoutine('r1');
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-10']);
  });

  it('withdraws the day when the task is unchecked', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seedRoutine();
    useQuestStore.getState().toggleRoutine('r1');
    useQuestStore.getState().toggleRoutine('r1');
    expect(useQuestStore.getState().taskHistory['r1']).toBeUndefined();
  });

  it('keeps days in ascending order across a gap, and a new cycle keeps the old ones', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seedRoutine({ lastResetAt: localTime(2026, AUG, 10, 6).toISOString() });
    useQuestStore.getState().toggleRoutine('r1');

    // Roll the cycle (missing the 11th entirely), then finish it on the 12th.
    vi.setSystemTime(localTime(2026, AUG, 12, 12));
    useQuestStore.getState().checkAndResetRecurring();
    expect(useQuestStore.getState().routines[0].completed).toBe(false);
    // The reset must not withdraw the 10th — a new cycle starting is not evidence
    // that the previous one didn't happen.
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-10']);

    useQuestStore.getState().toggleRoutine('r1');
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-10', '2026-08-12']);
  });

  it('counts a multi-day goal once per day, like the log', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seedRoutine({ recurring: 'weekly', target: 3, progress: 0 });
    useQuestStore.getState().incrementRoutine('r1', 1);
    useQuestStore.getState().incrementRoutine('r1', 1);
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-10']);
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(1);
  });

  it('holds no credit for a skipped day', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    seedRoutine();
    useQuestStore.getState().toggleRoutine('r1');
    useQuestStore.getState().skipRoutine('r1');
    // A skip is a neutral day: the streak survives, but nothing was done.
    expect(useQuestStore.getState().taskHistory['r1']).toBeUndefined();
    expect(useQuestStore.getState().completionLog['2026-08-10']).toBe(0);
  });

  it('attributes an un-check to the original day, not today', () => {
    useQuestStore.setState({
      questlines: [{
        id: 'ql', title: 'QL', description: '', icon: '', color: 'amber',
        quests: [{ id: 'q1', title: 'Q', description: '', order: 1, actions: [{ id: 'a1', title: 'One', completed: false }] }],
      }],
      routines: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    });
    vi.setSystemTime(localTime(2026, AUG, 9, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.getState().toggleAction('ql', 'q1', 'a1');
    // The 9th loses it; the 10th never had it and must not go negative-then-zero.
    expect(useQuestStore.getState().taskHistory['a1']).toBeUndefined();
    expect(useQuestStore.getState().completionLog['2026-08-09']).toBe(0);
  });

  it('records each action of a quest completed as a unit', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.setState({
      questlines: [{
        id: 'ql', title: 'QL', description: '', icon: '', color: 'amber',
        quests: [{
          id: 'q1', title: 'Q', description: '', order: 1,
          actions: [
            { id: 'a1', title: 'One', completed: false },
            { id: 'a2', title: 'Two', completed: false },
          ],
        }],
      }],
      routines: [], completionLog: {}, taskHistory: {}, todoOrder: {},
    });
    useQuestStore.getState().setQuestComplete('ql', 'q1', true);
    const h = useQuestStore.getState().taskHistory;
    expect(h['a1']).toEqual(['2026-08-10']);
    expect(h['a2']).toEqual(['2026-08-10']);
  });

  it('prunes days past the retention window', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.setState({
      questlines: [], routines: [routine({ recurring: 'daily' })], completionLog: {}, todoOrder: {},
      taskHistory: { r1: ['2024-01-01', '2026-08-09'] },
    });
    useQuestStore.getState().checkAndResetRecurring();
    expect(useQuestStore.getState().taskHistory['r1']).toEqual(['2026-08-09']);
  });

  it('keeps a just-deleted task’s history, so undo restores it whole', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.setState({
      questlines: [], routines: [], completionLog: {}, todoOrder: {},
      taskHistory: { gone: ['2026-08-09'] },
    });
    useQuestStore.getState().checkAndResetRecurring();
    // Orphaned, but recent — dropping it here would make an undo seconds later
    // restore a task with no past.
    expect(useQuestStore.getState().taskHistory['gone']).toEqual(['2026-08-09']);
  });

  it('eventually drops an orphan whose days have all aged out', () => {
    vi.setSystemTime(localTime(2026, AUG, 10, 12));
    useQuestStore.setState({
      questlines: [], routines: [], completionLog: {}, todoOrder: {},
      taskHistory: { gone: ['2026-05-01'] },
    });
    useQuestStore.getState().checkAndResetRecurring();
    expect(useQuestStore.getState().taskHistory['gone']).toBeUndefined();
  });
});
