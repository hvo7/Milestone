/**
 * Goal momentum.
 *
 * These guard the two ways this feature could lie. It could call a goal cold
 * while you were working on it — the fastest way to teach someone to ignore a
 * panel — or it could project a finish date off a weekend's burst and quietly
 * reassure you about a goal that has stopped. Both failures are silent, which is
 * exactly the kind this repo tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  questlineTaskIds, questCompletedDay, questlineStartDay, questlineMovement,
  questlinePace, questlineDeadline, questlineMomentum, momentumState, rankByNeglect,
  needsAttention, movedLabel, spanLabel, etaLabel, daysBetween, shiftDay,
  MOMENTUM_WINDOW_DAYS, COLD_AFTER_DAYS,
} from './momentum';
import type { Action, Quest, Questline, Routine } from '../types';

const NOW = new Date(2026, 8, 7, 12);          // 2026-09-07, midday
const TODAY = '2026-09-07';

/** A day key `n` days before today. */
const ago = (n: number) => shiftDay(TODAY, -n);
/** Midday of that day, as an ISO instant — safely inside the 5am logical day. */
const agoAt = (n: number) => new Date(`${ago(n)}T12:00:00`).toISOString();

const action = (over: Partial<Action> = {}): Action =>
  ({ id: 'a1', title: 'Task', completed: false, ...over });

const quest = (over: Partial<Quest> = {}): Quest =>
  ({ id: 'q1', title: 'Quest', description: '', order: 1, actions: [], ...over });

const questline = (over: Partial<Questline> = {}): Questline => ({
  id: 'ql1', title: 'Learn Korean', description: '', icon: '📘', color: 'blue',
  quests: [], ...over,
});

const routine = (over: Partial<Routine> = {}): Routine =>
  ({ id: 'r1', title: 'Habit', recurring: 'daily', completed: false, trackedToday: false, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe('day arithmetic', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-09-01', '2026-09-07')).toBe(6);
    expect(daysBetween('2026-09-07', '2026-09-01')).toBe(-6);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });

  it('crosses a month boundary and a DST change without drifting', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftDay('2026-03-07', 3)).toBe('2026-03-10');   // US DST falls in here
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
  });
});

describe('what belongs to a questline', () => {
  it('collects visible actions, action-less quests, and linked routines', () => {
    const ql = questline({
      quests: [
        quest({ id: 'q1', actions: [action({ id: 'a1' }), action({ id: 'a2', hidden: true })] }),
        quest({ id: 'q2', order: 2 }),                       // no actions — the quest itself
        quest({ id: 'q3', order: 3, hidden: true, actions: [action({ id: 'a3' })] }),
      ],
    });
    const routines = [
      routine({ id: 'r1', questlineId: 'ql1' }),
      routine({ id: 'r2', questlineId: 'other' }),
      routine({ id: 'r3', questlineId: 'ql1', hidden: true }),
    ];
    expect(questlineTaskIds(ql, routines)).toEqual(['a1', 'q2', 'r1']);
  });
});

describe('questCompletedDay', () => {
  it('dates an action-less quest by its own stamp', () => {
    expect(questCompletedDay(quest({ completed: true, completedAt: agoAt(3) }))).toBe(ago(3));
  });

  it('dates a quest with tasks by its LAST task, not its first', () => {
    const q = quest({
      actions: [
        action({ id: 'a1', completed: true, completedAt: agoAt(9) }),
        action({ id: 'a2', completed: true, completedAt: agoAt(2) }),
      ],
    });
    expect(questCompletedDay(q)).toBe(ago(2));
  });

  it('is null for an unfinished quest, and for one finished before stamps existed', () => {
    expect(questCompletedDay(quest({ actions: [action({ completed: false })] }))).toBeNull();
    expect(questCompletedDay(quest({ completed: true }))).toBeNull();          // no completedAt
    expect(questCompletedDay(quest({ actions: [action({ completed: true })] }))).toBeNull();
  });

  it('ignores hidden tasks when deciding both done-ness and date', () => {
    const q = quest({
      actions: [
        action({ id: 'a1', completed: true, completedAt: agoAt(5) }),
        action({ id: 'a2', completed: false, hidden: true }),
      ],
    });
    expect(questCompletedDay(q)).toBe(ago(5));
  });
});

describe('questlineMovement', () => {
  it('takes the most recent credit from anywhere under the goal', () => {
    const ql = questline({ quests: [quest({ actions: [action({ id: 'a1' })] })] });
    const routines = [routine({ id: 'r1', questlineId: 'ql1' })];
    const history = { a1: [ago(20), ago(11)], r1: [ago(4)] };

    const m = questlineMovement(ql, routines, history, NOW);
    expect(m.lastDay).toBe(ago(4));
    expect(m.daysSince).toBe(4);
    expect(m.moves).toBe(3);
    expect(m.activeDays).toBe(3);
  });

  it('counts several completions on one day as one active day', () => {
    const ql = questline({
      quests: [quest({ actions: [action({ id: 'a1' }), action({ id: 'a2' })] })],
    });
    const m = questlineMovement(ql, [], { a1: [ago(2)], a2: [ago(2)] }, NOW);
    expect(m.moves).toBe(2);
    expect(m.activeDays).toBe(1);
  });

  it('reports never-moved rather than pretending to a date', () => {
    const m = questlineMovement(questline({ quests: [quest()] }), [], {}, NOW);
    expect(m.lastDay).toBeNull();
    expect(m.daysSince).toBeNull();
  });

  it('clips the window to a young questline, so it is not scored over a month it did not exist for', () => {
    const young = questline({ createdAt: agoAt(5), quests: [quest({ actions: [action({ id: 'a1' })] })] });
    expect(questlineMovement(young, [], { a1: [ago(3)] }, NOW).days).toBe(6);

    const old = questline({ createdAt: agoAt(400), quests: [quest({ actions: [action({ id: 'a1' })] })] });
    expect(questlineMovement(old, [], { a1: [ago(3)] }, NOW).days).toBe(MOMENTUM_WINDOW_DAYS);
  });

  it('leaves credit older than the window out of the rate but still finds it for lastDay', () => {
    // The goal is stone cold; the panel must be able to say *how* cold, which
    // means reading a day the 30-day window itself has scrolled past.
    const ql = questline({ quests: [quest({ actions: [action({ id: 'a1' })] })] });
    const m = questlineMovement(ql, [], { a1: [ago(120)] }, NOW);
    expect(m.lastDay).toBe(ago(120));
    expect(m.daysSince).toBe(120);
    expect(m.moves).toBe(0);
  });
});

describe('questlineStartDay', () => {
  it('prefers the creation stamp', () => {
    expect(questlineStartDay(questline({ createdAt: agoAt(9) }), [], {})).toBe(ago(9));
  });

  it('falls back to the earliest recorded credit for a questline made before stamps existed', () => {
    const ql = questline({ quests: [quest({ actions: [action({ id: 'a1' })] })] });
    expect(questlineStartDay(ql, [], { a1: [ago(50), ago(12)] })).toBe(ago(50));
  });

  it('is null when there is nothing at all to go on', () => {
    expect(questlineStartDay(questline(), [], {})).toBeNull();
  });
});

describe('questlinePace', () => {
  /** A questline of `total` quests, the first `done` of them finished `spread`
   *  days apart working back from `latest` days ago. */
  const paced = (total: number, done: number, latest = 1, spread = 7): Questline =>
    questline({
      createdAt: agoAt(365),
      quests: Array.from({ length: total }, (_, i) => quest({
        id: `q${i + 1}`,
        order: i + 1,
        actions: [i < done
          ? action({ id: `a${i + 1}`, completed: true, completedAt: agoAt(latest + (done - 1 - i) * spread) })
          : action({ id: `a${i + 1}`, completed: false })],
      })),
    });

  it('projects a finish from the trailing rate', () => {
    // 3 quests closed in the last 30 days, 6 left → 10 days a quest, 60 to go.
    const p = questlinePace(paced(9, 3, 1, 7), [], {}, NOW);
    expect(p.finished).toBe(3);
    expect(p.remaining).toBe(6);
    expect(p.meaningful).toBe(true);
    expect(p.etaDays).toBe(60);
    expect(p.etaDay).toBe(shiftDay(TODAY, 60));
  });

  it('refuses to project from a window too young to mean anything', () => {
    // One quest closed yesterday on a questline three days old would forecast
    // the rest landing next week. That is a burst, not a rate.
    const ql = questline({
      createdAt: agoAt(3),
      quests: [
        quest({ id: 'q1', actions: [action({ id: 'a1', completed: true, completedAt: agoAt(1) })] }),
        quest({ id: 'q2', order: 2, actions: [action({ id: 'a2' })] }),
      ],
    });
    const p = questlinePace(ql, [], {}, NOW);
    expect(p.finished).toBe(1);
    expect(p.meaningful).toBe(false);
    expect(p.etaDays).toBeNull();
    expect(etaLabel(p)).toBeNull();
  });

  it('says nothing rather than "never" when the goal has stalled', () => {
    // Everything was finished long before the window. A rate of zero must not
    // become an infinite ETA, or a bar drawn at 0%.
    const p = questlinePace(paced(6, 2, 200, 7), [], {}, NOW);
    expect(p.finished).toBe(0);
    expect(p.perDay).toBe(0);
    expect(p.meaningful).toBe(false);
    expect(p.etaDays).toBeNull();
  });

  it('has nothing to project once the goal is finished', () => {
    const p = questlinePace(paced(3, 3, 1, 5), [], {}, NOW);
    expect(p.remaining).toBe(0);
    expect(etaLabel(p)).toBeNull();
  });
});

describe('questlineDeadline', () => {
  const pace = (over: Partial<ReturnType<typeof questlinePace>> = {}) =>
    ({ remaining: 4, finished: 2, perDay: 2 / 30, etaDays: 60, etaDay: shiftDay(TODAY, 60), meaningful: true, ...over });

  it('says nothing at all without a target date', () => {
    expect(questlineDeadline(questline(), pace(), NOW)).toBeNull();
  });

  it('compares the rate you have against the rate you need', () => {
    // 4 quests in 100 days needs 0.04/day; the actual rate is 0.067/day.
    const ahead = questlineDeadline(questline({ targetDate: shiftDay(TODAY, 100) }), pace(), NOW)!;
    expect(ahead.daysLeft).toBe(100);
    expect(ahead.onTrack).toBe(true);

    // Same work, 20 days: needs 0.2/day. Not close.
    const behind = questlineDeadline(questline({ targetDate: shiftDay(TODAY, 20) }), pace(), NOW)!;
    expect(behind.onTrack).toBe(false);
  });

  it('withholds a verdict when the rate is not meaningful', () => {
    const d = questlineDeadline(
      questline({ targetDate: shiftDay(TODAY, 30) }),
      pace({ meaningful: false, etaDays: null, etaDay: null, perDay: 0 }),
      NOW,
    )!;
    expect(d.onTrack).toBeNull();
  });

  it('handles a target already past, and a goal already finished', () => {
    const overdue = questlineDeadline(questline({ targetDate: ago(10) }), pace(), NOW)!;
    expect(overdue.daysLeft).toBe(-10);
    expect(overdue.neededPerDay).toBe(Infinity);
    expect(overdue.onTrack).toBe(false);

    const finished = questlineDeadline(questline({ targetDate: ago(10) }), pace({ remaining: 0 }), NOW)!;
    expect(finished.onTrack).toBe(true);
  });
});

describe('momentumState', () => {
  const move = (daysSince: number | null) =>
    ({ lastDay: daysSince === null ? null : ago(daysSince), daysSince, activeDays: 1, moves: 1, days: 30 });

  it('grades by how long it has been quiet', () => {
    expect(momentumState(move(0), { done: 1, total: 5 }, 100)).toBe('moving');
    expect(momentumState(move(7), { done: 1, total: 5 }, 100)).toBe('moving');
    expect(momentumState(move(8), { done: 1, total: 5 }, 100)).toBe('slowing');
    expect(momentumState(move(COLD_AFTER_DAYS), { done: 1, total: 5 }, 100)).toBe('slowing');
    expect(momentumState(move(COLD_AFTER_DAYS + 1), { done: 1, total: 5 }, 100)).toBe('cold');
  });

  it('reports a finished questline as done however long ago that was', () => {
    expect(momentumState(move(400), { done: 5, total: 5 }, 500)).toBe('done');
  });

  it('does not scold a questline created this week', () => {
    expect(momentumState(move(null), { done: 0, total: 3 }, 2)).toBe('idle');
  });

  it('does call one that has never moved since the month it was made cold', () => {
    expect(momentumState(move(null), { done: 0, total: 3 }, 40)).toBe('cold');
  });

  it('leaves an empty questline of unknown age alone', () => {
    expect(momentumState(move(null), { done: 0, total: 0 }, null)).toBe('idle');
  });
});

describe('rankByNeglect', () => {
  it('puts the coldest first and sinks what needs no attention', () => {
    const build = (id: string, title: string, daysSince: number | null, done = 0, total = 3) =>
      questlineMomentum(
        questline({
          id, title, createdAt: agoAt(200),
          quests: Array.from({ length: total }, (_, i) => quest({
            id: `${id}-q${i}`, order: i + 1,
            actions: [action({
              id: `${id}-a${i}`,
              completed: i < done,
              completedAt: i < done ? agoAt(daysSince ?? 0) : undefined,
            })],
          })),
        }),
        [],
        daysSince === null ? {} : { [`${id}-x`]: [] },
        NOW,
      );

    const warm = build('w', 'Warm', 1, 1);
    const stale = build('s', 'Stale', 40, 1);
    const mid = build('m', 'Mid', 12, 1);
    const finished = build('f', 'Finished', 3, 3, 3);

    const order = rankByNeglect([warm, finished, mid, stale]).map(m => m.questline.id);
    expect(order).toEqual(['s', 'm', 'w', 'f']);
    expect(needsAttention(stale)).toBe(true);
    expect(needsAttention(warm)).toBe(false);
    expect(needsAttention(finished)).toBe(false);
  });
});

describe('labels', () => {
  it('says how long ago in units a person would use', () => {
    const m = (daysSince: number | null) =>
      movedLabel({ lastDay: null, daysSince, activeDays: 0, moves: 0, days: 30 });
    expect(m(null)).toBe('no movement recorded');
    expect(m(0)).toBe('moved today');
    expect(m(1)).toBe('moved yesterday');
    expect(m(5)).toBe('moved 5 days ago');
    expect(m(21)).toBe('moved 3 weeks ago');
    expect(m(90)).toBe('moved 3 months ago');
    expect(m(400)).toBe('moved over 1 year ago');
    expect(m(800)).toBe('moved over 2 years ago');
  });

  it('rounds a span hard rather than claiming a date', () => {
    expect(spanLabel(1)).toBe('a day');
    expect(spanLabel(9)).toBe('9 days');
    expect(spanLabel(30)).toBe('4 weeks');
    expect(spanLabel(120)).toBe('4 months');
    expect(spanLabel(1000)).toBe('2.7 years');
  });
});

describe('questlineMomentum', () => {
  it('reads a real goal end to end', () => {
    const ql = questline({
      title: 'Read 5 Books',
      createdAt: agoAt(180),
      targetDate: shiftDay(TODAY, 120),
      quests: [
        quest({ id: 'q1', order: 1, actions: [action({ id: 'a1', completed: true, completedAt: agoAt(25) })] }),
        quest({ id: 'q2', order: 2, actions: [action({ id: 'a2', completed: true, completedAt: agoAt(10) })] }),
        quest({ id: 'q3', order: 3, actions: [action({ id: 'a3', completed: false })] }),
        quest({ id: 'q4', order: 4, actions: [action({ id: 'a4', completed: false })] }),
      ],
    });
    const m = questlineMomentum(ql, [], { a1: [ago(25)], a2: [ago(10)] }, NOW);

    expect(m.progress).toEqual({ done: 2, total: 4 });
    expect(m.movement.daysSince).toBe(10);
    expect(m.state).toBe('slowing');
    expect(m.pace.finished).toBe(2);
    expect(m.pace.etaDays).toBe(30);          // 2 in 30 days → 15 a quest, 2 left
    expect(m.deadline!.onTrack).toBe(true);   // 30 days of work, 120 to spend
    expect(etaLabel(m.pace)).toBe('about 4 weeks left at this rate');
  });

  it('is the perfect-heatmap case: nothing under the goal moved, so it reads cold', () => {
    // The failure this feature exists for — a month of green squares earned
    // entirely by habits filed elsewhere, while this goal sat still.
    const ql = questline({
      createdAt: agoAt(200),
      quests: [quest({ id: 'q1', actions: [action({ id: 'a1' })] })],
    });
    const elsewhere = { 'someone-elses-habit': Array.from({ length: 30 }, (_, i) => ago(i)) };
    const m = questlineMomentum(ql, [], elsewhere, NOW);

    expect(m.movement.daysSince).toBeNull();
    expect(m.state).toBe('cold');
    expect(needsAttention(m)).toBe(true);
  });
});
