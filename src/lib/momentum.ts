/**
 * Momentum: whether a goal is actually going anywhere.
 *
 * The app was always good at pushing *down* — questline into quests, quests into
 * tasks, tasks onto Today. Nothing came back *up*. A questline's only reading was
 * `done / total`, a ratio with no time in it: "FIRE — 3 of 11" looks identical
 * whether you closed a quest yesterday or eight months ago. So a goal could not
 * be late, could not be behind, and above all could not go quiet — and going
 * quiet is how long-term goals actually die. Not with a broken streak, but with
 * a perfect one somewhere else while this sits untouched.
 *
 * The counterpart on the Systems tab (`lib/systems.ts`) answers the same question
 * one level down, and deliberately refuses to score outcomes: a *process* is
 * either being run or it isn't. That refusal is right about systems and wrong
 * about goals, because the thing worth knowing about a goal is not "am I hitting
 * it" — nothing to act on, zero most of its life — but "is it still moving".
 * That question has an honest answer in data already stored.
 *
 * ── What counts as movement ─────────────────────────────────────────────────
 * Any credit earned by anything belonging to the questline: a task ticked, an
 * action-less quest checked off, a linked routine run. Ticking one sub-task of
 * one quest is movement — it is not progress toward *finishing*, but it is proof
 * the goal is still alive, which is the thing being measured.
 *
 * ── What is deliberately not modelled ───────────────────────────────────────
 * Editing is not movement. Renaming a quest, reordering the list or adding five
 * new tasks all feel productive and move nothing; counting them would let a goal
 * look healthy on the strength of being fiddled with. Only completions count.
 *
 * Everything here is pure, so it can be tested directly and the panels can render
 * numbers nobody had to store.
 */
import type { Questline, Quest, Routine } from '../types';
import { dateKey, logicalDateKey, logicalDayStart } from '../domain/schedule';
import { historyOf, type TaskHistory } from '../domain/taskState';
import { isQuestComplete, questlineProgress } from '../domain/taskState';

/** Trailing window every rate here is computed over. The same length as the habit
 *  score, for the same reason: long enough that one quiet week doesn't swing it,
 *  short enough to still describe now. */
export const MOMENTUM_WINDOW_DAYS = 30;

/** Moved within this many days — still warm. A week is the shortest span that
 *  doesn't call an ordinary busy weekend a stall. */
export const MOVING_WITHIN_DAYS = 7;

/** Past this, a goal has stopped rather than paused. Three weeks is chosen to be
 *  clearly longer than a holiday and clearly shorter than a season: by then
 *  "I'll get back to it" has been true long enough to stop being true. */
export const COLD_AFTER_DAYS = 21;

/** A projection needs at least this much history behind it. Below it, one good
 *  afternoon would forecast the whole goal landing next month. */
export const PACE_MIN_DAYS = 14;

const DAY_MS = 86_400_000;

/** Midday of a day key — the hour arithmetic crosses DST on without drifting. */
const noon = (key: string): number => new Date(`${key}T12:00:00`).getTime();

/** Whole days from one logical day key to another. Negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((noon(to) - noon(from)) / DAY_MS);

/** The day key `n` days after `key` (or before it, for negative `n`). */
export const shiftDay = (key: string, n: number): string =>
  dateKey(new Date(noon(key) + n * DAY_MS));

// ── What belongs to a questline ──────────────────────────────────────────────

/**
 * Every id under this questline that `taskHistory` can carry credit for.
 *
 * A quest contributes its visible actions, or — having none — itself, which is
 * exactly the split `setQuestComplete` writes history under. Linked routines are
 * included because a habit filed against a questline is work on that goal; one
 * that also serves a system still counts here, since the system is *how* you run
 * and the questline is *what for*.
 */
export function questlineTaskIds(questline: Questline, routines: Routine[] = []): string[] {
  const ids: string[] = [];
  for (const quest of questline.quests) {
    if (quest.hidden) continue;
    const visible = quest.actions.filter(a => !a.hidden);
    if (visible.length === 0) ids.push(quest.id);
    else for (const action of visible) ids.push(action.id);
  }
  for (const r of routines) {
    if (r.questlineId === questline.id && !r.hidden) ids.push(r.id);
  }
  return ids;
}

/**
 * The logical day a quest was finished on, or null.
 *
 * Null covers two different things on purpose: not finished, and finished before
 * completion stamps existed. Both mean "this cannot be placed in time", and a
 * projection that guessed a date for the second would be inventing history — the
 * same reason the Consistency panel says its history only counts forward.
 */
export function questCompletedDay(quest: Quest): string | null {
  if (!isQuestComplete(quest)) return null;
  const visible = quest.actions.filter(a => !a.hidden);
  if (visible.length === 0) {
    return quest.completedAt ? logicalDateKey(new Date(quest.completedAt)) : null;
  }
  // A quest was finished when its *last* task was, not its first.
  const stamps = visible.map(a => a.completedAt).filter((s): s is string => !!s);
  if (!stamps.length) return null;
  return logicalDateKey(new Date(stamps.reduce((a, b) => (a > b ? a : b))));
}

/**
 * The day this questline started counting: when it was created, else the first
 * day anything under it earned credit. Scoring a goal over a month it did not
 * exist for would punish you for starting it.
 */
export function questlineStartDay(
  questline: Questline,
  routines: Routine[],
  history: TaskHistory | undefined,
): string | null {
  if (questline.createdAt) return dateKey(logicalDayStart(new Date(questline.createdAt)));
  const days = questlineTaskIds(questline, routines).flatMap(id => historyOf(history, id));
  return days.length ? days.reduce((a, b) => (a < b ? a : b)) : null;
}

// ── Movement ─────────────────────────────────────────────────────────────────

export interface Movement {
  /** Logical day key of the most recent movement, or null if it has never moved. */
  lastDay: string | null;
  /** Whole days since that day. Null when there is nothing to count from. */
  daysSince: number | null;
  /** Distinct days inside the window that saw any movement. */
  activeDays: number;
  /** Individual completions inside the window — several on one day count several. */
  moves: number;
  /** Days the reading covers: the window, clipped to the questline's own age. */
  days: number;
}

/** When anything under this questline last moved, and how busy it has been. */
export function questlineMovement(
  questline: Questline,
  routines: Routine[],
  history: TaskHistory | undefined,
  at: Date = new Date(),
): Movement {
  const today = dateKey(logicalDayStart(at));
  const floor = shiftDay(today, -(MOMENTUM_WINDOW_DAYS - 1));
  const start = questlineStartDay(questline, routines, history);
  const from = start && start > floor ? start : floor;

  const logged = questlineTaskIds(questline, routines).flatMap(id => historyOf(history, id));

  // Days a quest was *finished* count too, so a questline whose quests carry no
  // sub-tasks still registers where the stamp predates per-task history.
  const questDays = questline.quests
    .filter(q => !q.hidden)
    .map(questCompletedDay)
    .filter((d): d is string => d !== null);

  const everything = [...logged, ...questDays];
  const lastDay = everything.length ? everything.reduce((a, b) => (a > b ? a : b)) : null;
  const inWindow = everything.filter(d => d >= from && d <= today);

  return {
    lastDay,
    // Clamped at zero: a completion stamped later today than the logical day
    // start is still "today", never negative days ago.
    daysSince: lastDay ? Math.max(0, daysBetween(lastDay, today)) : null,
    activeDays: new Set(inWindow).size,
    moves: inWindow.length,
    days: daysBetween(from, today) + 1,
  };
}

// ── Pace ─────────────────────────────────────────────────────────────────────

export interface Pace {
  /** Visible quests still to finish. */
  remaining: number;
  /** Quests finished inside the window — the numerator of the rate. */
  finished: number;
  /** Quests per day. Zero when nothing landed in the window. */
  perDay: number;
  /** Days until the last remaining quest, at this rate. Null when it can't be said. */
  etaDays: number | null;
  /** The day that lands on. Null whenever `etaDays` is. */
  etaDay: string | null;
  /** False when the window is too young, or too empty, to project from. */
  meaningful: boolean;
}

/**
 * At the rate of the last thirty days, when does this finish?
 *
 * A rate, not a promise — which is why the label rounds hard ("about 4 months")
 * instead of naming a date. The useful output is often not the estimate but its
 * absence: a goal with real work left and no rate at all is one you have stopped
 * paying into, and saying nothing is more honest than drawing a bar.
 */
export function questlinePace(
  questline: Questline,
  routines: Routine[],
  history: TaskHistory | undefined,
  at: Date = new Date(),
): Pace {
  const today = dateKey(logicalDayStart(at));
  const floor = shiftDay(today, -(MOMENTUM_WINDOW_DAYS - 1));
  const start = questlineStartDay(questline, routines, history);
  const from = start && start > floor ? start : floor;
  const days = daysBetween(from, today) + 1;

  const { done, total } = questlineProgress(questline);
  const remaining = total - done;

  const finished = questline.quests
    .filter(q => !q.hidden)
    .map(questCompletedDay)
    .filter((d): d is string => d !== null && d >= from && d <= today).length;

  const perDay = days > 0 ? finished / days : 0;
  const meaningful = days >= PACE_MIN_DAYS && finished > 0 && remaining > 0;
  const etaDays = meaningful ? Math.ceil(remaining / perDay) : null;

  return {
    remaining,
    finished,
    perDay,
    etaDays,
    etaDay: etaDays === null ? null : shiftDay(today, etaDays),
    meaningful,
  };
}

// ── A date you're aiming at ──────────────────────────────────────────────────

export interface Deadline {
  /** The target itself, as a day key. */
  day: string;
  /** Whole days from today. Negative once it has passed. */
  daysLeft: number;
  /** Quests per day needed to land the rest in time. Infinity when out of days. */
  neededPerDay: number;
  /** Is the current rate enough? Null when there is no rate worth comparing. */
  onTrack: boolean | null;
}

/**
 * How the target date and the actual rate compare.
 *
 * `targetDate` is optional by design, the same way a System's goal is: a goal
 * with no deadline is still a goal, and a date invented so the app could draw a
 * bar would be the app making up your intent. With no target this returns null
 * and nothing is said.
 */
export function questlineDeadline(
  questline: Questline,
  pace: Pace,
  at: Date = new Date(),
): Deadline | null {
  if (!questline.targetDate) return null;
  const today = dateKey(logicalDayStart(at));
  const daysLeft = daysBetween(today, questline.targetDate);
  const neededPerDay =
    pace.remaining === 0 ? 0 : daysLeft > 0 ? pace.remaining / daysLeft : Infinity;
  return {
    day: questline.targetDate,
    daysLeft,
    neededPerDay,
    onTrack:
      pace.remaining === 0 ? true : pace.meaningful ? pace.perDay >= neededPerDay : null,
  };
}

// ── The headline ─────────────────────────────────────────────────────────────

/**
 * `idle` is not a soft word for `cold`. It means the questline is too new to have
 * a verdict — judging a goal you set on Tuesday is noise, and a panel that greets
 * every new questline with a warning teaches you to ignore it.
 */
export type MomentumState = 'done' | 'moving' | 'slowing' | 'cold' | 'idle';

export interface QuestlineMomentum {
  questline: Questline;
  state: MomentumState;
  movement: Movement;
  pace: Pace;
  /** Null unless a target date is set. */
  deadline: Deadline | null;
  progress: { done: number; total: number };
}

export function momentumState(
  movement: Movement,
  progress: { done: number; total: number },
  ageDays: number | null,
): MomentumState {
  if (progress.total > 0 && progress.done === progress.total) return 'done';
  if (movement.daysSince === null) {
    // Never moved. Brand new is not the same as abandoned — but a goal that has
    // sat untouched since the week it was created is exactly as cold as one that
    // stopped, and the panel should say so.
    return ageDays !== null && ageDays > MOVING_WITHIN_DAYS ? 'cold' : 'idle';
  }
  if (movement.daysSince <= MOVING_WITHIN_DAYS) return 'moving';
  if (movement.daysSince <= COLD_AFTER_DAYS) return 'slowing';
  return 'cold';
}

/** Everything the momentum surfaces need about one questline, in one pass. */
export function questlineMomentum(
  questline: Questline,
  routines: Routine[],
  history: TaskHistory | undefined,
  at: Date = new Date(),
): QuestlineMomentum {
  const movement = questlineMovement(questline, routines, history, at);
  const pace = questlinePace(questline, routines, history, at);
  const progress = questlineProgress(questline);
  const start = questlineStartDay(questline, routines, history);
  const ageDays = start ? daysBetween(start, dateKey(logicalDayStart(at))) : null;

  return {
    questline,
    state: momentumState(movement, progress, ageDays),
    movement,
    pace,
    deadline: questlineDeadline(questline, pace, at),
    progress,
  };
}

/** Sort order for the panel: coldest first, and within a state the one that has
 *  been quiet longest. Finished and brand-new questlines sink — neither is
 *  something to do anything about. */
const STATE_RANK: Record<MomentumState, number> = {
  cold: 0, slowing: 1, moving: 2, idle: 3, done: 4,
};

export function rankByNeglect(items: QuestlineMomentum[]): QuestlineMomentum[] {
  return [...items].sort((a, b) => {
    const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (byState !== 0) return byState;
    // Never-moved sorts as maximally quiet within its own state.
    const aq = a.movement.daysSince ?? Number.POSITIVE_INFINITY;
    const bq = b.movement.daysSince ?? Number.POSITIVE_INFINITY;
    if (aq !== bq) return bq - aq;
    return a.questline.title.localeCompare(b.questline.title);
  });
}

/** Anything you might actually do something about today. */
export const needsAttention = (m: QuestlineMomentum): boolean =>
  m.state === 'cold' || m.state === 'slowing';

// ── Words and colours ────────────────────────────────────────────────────────

/**
 * Colour for a state. Cold is grey, not red, for the reason the Systems tab
 * gives: a stalled goal is information, not a failure notice, and the whole point
 * of showing it is to make picking it back up feel ordinary.
 */
export function momentumHex(state: MomentumState): string {
  switch (state) {
    case 'done':    return 'var(--success)';
    case 'moving':  return '#34d399';
    case 'slowing': return '#fbbf24';
    case 'cold':    return '#94a3b8';
    case 'idle':    return 'var(--text-dim)';
  }
}

export const STATE_LABEL: Record<MomentumState, string> = {
  done: 'complete',
  moving: 'moving',
  slowing: 'slowing',
  cold: 'cold',
  idle: 'not started',
};

/** "moved today" / "moved 3 days ago" / "no movement recorded". */
export function movedLabel(movement: Movement): string {
  const n = movement.daysSince;
  if (n === null) return 'no movement recorded';
  if (n === 0) return 'moved today';
  if (n === 1) return 'moved yesterday';
  if (n < 14) return `moved ${n} days ago`;
  if (n < 60) return `moved ${Math.round(n / 7)} weeks ago`;
  if (n < 365) return `moved ${Math.round(n / 30)} months ago`;
  const years = Math.floor(n / 365);
  return `moved over ${years} year${years === 1 ? '' : 's'} ago`;
}

/** A rounded span, never a date — the estimate isn't precise enough to spell one,
 *  and printing "14 March 2028" would claim a confidence it doesn't have. */
export function spanLabel(days: number): string {
  if (days <= 1) return 'a day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  const years = days / 365;
  return `${years < 10 ? years.toFixed(1).replace(/\.0$/, '') : Math.round(years)} years`;
}

/** What the trailing rate says about finishing. Null when there's nothing to say. */
export function etaLabel(pace: Pace): string | null {
  if (pace.remaining === 0 || !pace.meaningful || pace.etaDays === null) return null;
  return `about ${spanLabel(pace.etaDays)} left at this rate`;
}
