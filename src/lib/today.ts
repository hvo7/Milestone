/**
 * What belongs on a given day's list, as pure functions over stored data.
 *
 * These used to live inside pages/Today.tsx, where they could only be reached by
 * rendering the page. Two things need them without rendering anything: the
 * reminder scheduler (which has to know whether there is anything left to nudge
 * about) and the tests (which have to be able to ask the question directly).
 *
 * `dayKey` and `dayStart` travel together throughout — a 'YYYY-MM-DD' logical-day
 * key and that day's midnight — so the Today tab's tomorrow preview can ask every
 * one of these about the *next* day by passing a different pair.
 */
import type { Action, Quest, Questline, Routine } from '../types';
import { alwaysOnToday, dateKey, dueOnDay, isMultiDayCycle, logicalDateKey, logicalDayStart, onToday, repeats, skipActive } from '../domain/schedule';
import { engagedOnDay, isGeneralTask } from '../domain/taskState';
import { isQuestComplete } from '../domain/taskState';

// The rule lives in the store, beside the other schedule predicates; re-exported
// here so callers that think in terms of "the Today page" can reach it too.
export { alwaysOnToday, onToday } from '../store';
export type { FixedReason } from '../store';
import type { VynuesProject, VynuesTask } from '../vynuesStore';

/**
 * Does a routine belong on the given logical day's list?
 * - Daily tasks always surface.
 * - Anchor habits and multi-day *goals* (weekly "gym 3×" counters, or weekly
 *   tasks with steps) surface every day while open — an anchor is the practice
 *   you singled out, a goal is built to be chipped away at — and, once fully
 *   complete, linger only through the day they were finished.
 * - Other weekly / monthly / interval tasks surface on the day their period ends
 *   (or when pinned) — that list is for work due *that day*.
 * - An explicit due date must match the viewed day, even when pinned.
 * - Undated General one-offs surface only when pinned; linked tasks keep their place.
 * - Completed one-offs linger only through their completion day.
 */
export function showsOnDay(r: Routine, dayKey: string, dayStart: Date): boolean {
  if (!dueDateMatchesDay(r, dayKey) || r.offToday) return false;
  if (repeats(r)) {
    const fixed = alwaysOnToday(r);
    if (fixed === 'daily') return true;
    // Anchors and goals linger through their completion day, then drop.
    if (fixed) {
      if (r.completed) return !!r.completedAt && logicalDateKey(new Date(r.completedAt)) === dayKey;
      return true;
    }
    return !!r.trackedToday || dueOnDay(r, dayStart);
  }
  if (!r.dueDate && isGeneralTask(r) && !onToday(r)) return false;
  if (r.completed) return !!r.completedAt && logicalDateKey(new Date(r.completedAt)) === dayKey;
  return true;
}

/** The Vynues equivalent of `showsOnDay`. */
export function vynuesShowsOnDay(t: VynuesTask, dayKey: string, dayStart: Date): boolean {
  if (t.offToday || !dueDateMatchesDay(t, dayKey)) return false;
  if (repeats(t)) {
    if (t.recurring === 'daily' && !t.intervalDays && !t.monthlyRule) return true;
    return !!t.tracked || dueOnDay(t, dayStart);
  }
  const due = t.tracked || !!t.dueDate;
  if (!due) return false;
  if (t.done) return !!t.completedAt && logicalDateKey(new Date(t.completedAt)) === dayKey;
  return true;
}

/** Explicit dates never spill into another day's list, even through a pin. */
export function dueDateMatchesDay(task: { dueDate?: string | null }, dayKey: string): boolean {
  return !task.dueDate || task.dueDate.slice(0, 10) === dayKey;
}

export function questShowsOnDay(q: Quest, dayKey: string): boolean {
  return !q.hidden && !q.offToday && dueDateMatchesDay(q, dayKey) && (!!q.trackedToday || !!q.dueDate);
}

/** Stable grouping keeps the user's order within active and settled tasks. */
export function activeTasksFirst<T extends { completed: boolean; todayDone?: boolean; skipped?: boolean }>(items: T[]): T[] {
  const settled = (item: T) => !!(item.completed || item.todayDone || item.skipped);
  return [...items].sort((a, b) => Number(settled(a)) - Number(settled(b)));
}

/** Is this quest action on the day's list? Mirrors the quest branch of the page's
 *  own derivation — pinned one-offs, dailies always, everything else when due. */
export function actionShowsOnDay(a: Action, dayStart: Date): boolean {
  if (a.hidden || a.offToday) return false;
  if (!repeats(a)) return !!a.trackedToday;
  if (a.recurring === 'daily' && !a.intervalDays && !a.monthlyRule) return true;
  return !!a.trackedToday || dueOnDay(a, dayStart);
}

/** Is a routine's share of *this* day done? A weekly "gym 3×" goal with a session
 *  logged today reads as settled for today even though the goal is still open —
 *  the same rule the page uses to move a row into "Done for today". */
export const routineSettledOnDay = (r: Routine, dayKey: string): boolean =>
  r.completed || (isMultiDayCycle(r) && !skipActive(r, dayKey) && engagedOnDay(r, dayKey));

export interface DueSummary {
  /** Still to do — the number a reminder is worth sending about. */
  open: number;
  /** Everything on the list, settled or not. */
  total: number;
  /** Titles of the open items, in the order they were found. A reminder that
   *  names two of them is worth reading; a bare count is not. */
  openTitles: string[];
}

/**
 * How much of today is left, across every source Today draws from.
 *
 * Deliberately counts the same rows the page renders — a nudge that says "3 left"
 * over a screen showing four is worse than no nudge. Skipped tasks are excluded
 * from both numbers: a skip is an explicit "not today", and nagging about one
 * would defeat the point of having skipped it.
 */
export function dueSummary(
  quest: { questlines: Questline[]; routines: Routine[] },
  vynues: { projects: VynuesProject[] },
  dayStart: Date = logicalDayStart(),
): DueSummary {
  const dayKey = dateKey(dayStart);
  let open = 0;
  let total = 0;
  const openTitles: string[] = [];
  const count = (settled: boolean, title: string) => {
    total += 1;
    if (settled) return;
    open += 1;
    openTitles.push(title);
  };

  for (const r of quest.routines) {
    if (r.hidden || !showsOnDay(r, dayKey, dayStart)) continue;
    if (skipActive(r, dayKey)) continue;
    count(routineSettledOnDay(r, dayKey), r.title);
  }

  for (const ql of quest.questlines) {
    for (const q of ql.quests) {
      if (q.hidden || !dueDateMatchesDay(q, dayKey)) continue;
      // A quest pinned as a unit owns its actions on Today, so it counts as one
      // row and they don't count at all — exactly as the page renders it.
      if (questShowsOnDay(q, dayKey)) { count(isQuestComplete(q), q.title); continue; }
      for (const a of q.actions) {
        if (actionShowsOnDay(a, dayStart)) count(a.completed, a.title);
      }
    }
  }

  for (const p of vynues.projects) {
    for (const t of p.tasks) {
      if (!(p.status === 'active' || t.tracked)) continue;
      if (!vynuesShowsOnDay(t, dayKey, dayStart)) continue;
      count(t.done, t.title);
    }
  }

  return { open, total, openTitles };
}
