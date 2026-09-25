import { type Action, type Routine, type Schedule, type MonthlyRule } from '../types';
import {
  occursOn, lastOccurrenceOnOrBefore, nextOccurrenceAfter, monthlyRuleLabel, monthlyRuleShort,
} from '../lib/monthlyRule';

export function recurrenceLabel(s: Schedule): string {
  const { recurring, intervalDays, monthlyRule } = s;
  if (monthlyRule) return monthlyRuleShort(monthlyRule);
  if (intervalDays && intervalDays > 0) {
    if (intervalDays % 30 === 0) { const n = intervalDays / 30; return n === 1 ? 'Monthly' : `Every ${n} months`; }
    if (intervalDays % 7 === 0)  { const n = intervalDays / 7;  return n === 1 ? 'Weekly'  : `Every ${n} weeks`; }
    return intervalDays === 1 ? 'Daily' : `Every ${intervalDays} days`;
  }
  if (!recurring) return 'Once';
  return recurring === 'daily' ? 'Daily' : recurring === 'weekly' ? 'Weekly' : 'Monthly';
}

export function getResetDisplay(s: Schedule): string {
  const { recurring, intervalDays, monthlyRule, lastResetAt } = s;
  const now = Date.now();
  // A calendar rule knows its own next date — no interval arithmetic involved.
  if (monthlyRule) {
    const next = nextOccurrenceAfter(logicalDayStart(), monthlyRule);
    if (!next) return monthlyRuleLabel(monthlyRule);
    const d = Math.round((next.getTime() - logicalDayStart().getTime()) / 86_400_000);
    return d <= 0 ? 'Due today' : d === 1 ? 'Next tomorrow' : `Next in ${d}d`;
  }
  if (intervalDays && intervalDays > 0) {
    if (!lastResetAt) return recurrenceLabel(s);
    const next = logicalDayStart(new Date(lastResetAt)).getTime() + intervalDays * 86_400_000;
    const ms = next - now;
    const d = Math.ceil(ms / 86_400_000);
    return d > 0 ? `Resets in ${d}d` : 'Resets soon';
  }
  if (recurring === 'daily') {
    const ms = nextDailyReset().getTime() - now;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `Resets in ${h}h ${m}m` : `Resets in ${m}m`;
  }
  if (recurring === 'weekly') {
    const ms = nextWeekReset().getTime() - now;
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    if (d === 0) return `Resets in ${h}h`;
    if (d === 1) return 'Resets tomorrow (Sun)';
    return `Resets Sunday in ${d}d`;
  }
  if (!lastResetAt) return 'Resets monthly';
  const next = new Date(lastResetAt).getTime() + MONTHLY_MS;
  const days = Math.ceil((next - now) / 86_400_000);
  return days > 0 ? `Resets in ${days}d` : 'Resets soon';
}

export interface DueDateInfo { text: string; urgency: 'ok' | 'soon' | 'urgent' | 'overdue'; }

export function getDueDateInfo(dueDate: string): DueDateInfo {
  const ms = new Date(dueDate).getTime() - Date.now();
  if (ms < 0) {
    const d = Math.floor(-ms / 86_400_000);
    const h = Math.floor((-ms % 86_400_000) / 3_600_000);
    return { text: d > 0 ? `Overdue ${d}d ${h}h` : `Overdue ${h}h`, urgency: 'overdue' };
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const text = d >= 1 ? `Due in ${d}d ${h}h` : h > 0 ? `Due in ${h}h ${m}m` : `Due in ${m}m`;
  return { text, urgency: d >= 7 ? 'ok' : d >= 3 ? 'soon' : 'urgent' };
}

// ── Reset helpers ─────────────────────────────────────────────────────────────

const MONTHLY_MS = 30 * 86_400_000;

/** Daily/weekly cycles roll over at this local hour instead of midnight, so
 *  late-night work (after 12am but before 2am) still counts toward the day that
 *  just ended rather than triggering an early reset. */
export const DAY_RESET_HOUR = 2;

/** Midnight of the *logical* day an instant belongs to. Times before
 *  DAY_RESET_HOUR count as the previous calendar day. */
export function logicalDayStart(d: Date = new Date()): Date {
  const x = new Date(d);
  if (x.getHours() < DAY_RESET_HOUR) x.setDate(x.getDate() - 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** The next daily rollover instant — DAY_RESET_HOUR on the morning that ends
 *  the current logical day. */
export function nextDailyReset(ref: Date = new Date()): Date {
  const d = logicalDayStart(ref);
  d.setDate(d.getDate() + 1);
  d.setHours(DAY_RESET_HOUR, 0, 0, 0);
  return d;
}

/** Start of the current logical week: DAY_RESET_HOUR on the most recent Sunday. */
function thisWeekReset(ref: Date = new Date()): Date {
  const d = logicalDayStart(ref);
  d.setDate(d.getDate() - d.getDay()); // back to the (logical) Sunday
  d.setHours(DAY_RESET_HOUR, 0, 0, 0);
  return d;
}

/** The next weekly rollover instant. */
function nextWeekReset(): Date {
  const d = thisWeekReset();
  d.setDate(d.getDate() + 7);
  return d;
}

/** `at` lets callers ask the question for a moment other than now — the Today tab's
 *  tomorrow preview probes an instant inside the next logical day to simulate which
 *  tasks will have reset by then. */
export function periodExpired(s: Schedule, at: Date = new Date()): boolean {
  const { recurring, intervalDays, monthlyRule, lastResetAt } = s;
  if (!lastResetAt) return false;
  // A calendar rule outranks everything: the cycle turns over the moment a new
  // occurrence date has passed since the last reset.
  if (monthlyRule) {
    const occ = lastOccurrenceOnOrBefore(logicalDayStart(at), monthlyRule);
    if (!occ) return false;
    return logicalDayStart(new Date(lastResetAt)).getTime() < occ.getTime();
  }
  // A custom interval overrides the base cadence and is measured in whole logical days.
  if (intervalDays && intervalDays > 0) {
    return logicalDayStart(at).getTime() - logicalDayStart(new Date(lastResetAt)).getTime() >= intervalDays * 86_400_000;
  }
  if (!recurring) return false;
  const last = new Date(lastResetAt);
  if (recurring === 'daily')   return logicalDayStart(last).getTime() !== logicalDayStart(at).getTime();
  if (recurring === 'weekly')  return last < thisWeekReset(at);
  return at.getTime() - last.getTime() >= MONTHLY_MS;
}

/** Is a recurring cadence actually *due* on the logical day starting at `dayStart`
 *  (i.e. its current period ends within that day)? Daily is due every day; weekly
 *  on the last day of the logical week (Saturday, since weeks reset Sunday 2am);
 *  monthly and custom intervals on the final day of their cycle. Today only
 *  surfaces recurring work that is due (or manually pinned) — everything else
 *  waits in the All tab until its day comes. */
export function dueOnDay(s: Schedule, dayStart: Date): boolean {
  const { recurring, intervalDays, monthlyRule, lastResetAt } = s;
  // A calendar rule fires on exactly its own date — nothing else to reason about.
  if (monthlyRule) return occursOn(dayStart, monthlyRule);
  if (intervalDays && intervalDays > 0) {
    // A just-(re)started cycle has no meaningful lastResetAt yet — treat as not due.
    if (!lastResetAt) return false;
    return dayStart.getTime() >= logicalDayStart(new Date(lastResetAt)).getTime() + (intervalDays - 1) * 86_400_000;
  }
  if (recurring === 'daily')  return true;
  if (recurring === 'weekly') return dayStart.getDay() === 6;
  if (recurring === 'monthly') {
    if (!lastResetAt) return false;
    // Due once the 30-day mark lands before this logical day's 2am rollover.
    return new Date(lastResetAt).getTime() + MONTHLY_MS < dayStart.getTime() + 86_400_000 + DAY_RESET_HOUR * 3_600_000;
  }
  return false;
}

/**
 * Is this routine's skip still in force?
 *
 * A skip excuses exactly the *day* it was made — every task, every cadence. It
 * lapses at the next 2am rollover and the task simply comes back. (Skips used to
 * excuse a repeating task's whole cycle, which meant skipping Monday's session of a
 * weekly "gym 3×" goal silently wrote off the entire week. Now Tuesday it's back.)
 * The streak stays protected across the cycle via `skippedInCycle`, which
 * `processRoutines` reads at rollover.
 */
export function skipActive(r: Routine, todayKey: string = logicalDateKey()): boolean {
  return !!r.skippedOn && r.skippedOn === todayKey;
}

// ── Multi-day goals & per-day engagement ─────────────────────────────────────
// A weekly/monthly/interval task spans several days. "Did I move it forward
// *today*?" is a different question from "is it fully done?", and Today's list
// cares about both: a gym session logged today should count as today's task done
// even though the weekly 3× goal is still open.

/** True when the task's cycle spans more than one logical day (weekly, monthly,
 *  or a custom interval of 2+ days). Dailies and one-offs are not multi-day. */
/** Does this thing repeat at all? True for any cadence, custom interval, or
 *  calendar rule — the one question every "is it a one-off?" check should ask,
 *  so a monthly rule is never mistaken for a one-time task. */
export const repeats = (s: Schedule): boolean =>
  !!s.recurring || !!s.intervalDays || !!s.monthlyRule;

/** Are two calendar rules the same schedule? The pickers re-emit on every click,
 *  so the setters compare before writing — without this a re-pick of the current
 *  rule would restart the reset clock and wipe the streak. `anchorMonth` is part
 *  of the identity: it decides which months an "every N months" rule fires in. */
export function sameRule(a?: MonthlyRule | null, b?: MonthlyRule | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.nth === b.nth
    && a.kind === b.kind
    && (a.months ?? 1) === (b.months ?? 1)
    && (a.anchorMonth ?? null) === (b.anchorMonth ?? null);
}

export function isMultiDayCycle(r: Schedule): boolean {
  // A calendar rule names one specific date, so it's a single-day task that
  // happens to repeat monthly — not a span you chip away at.
  if (r.monthlyRule) return false;
  if (r.intervalDays && r.intervalDays > 1) return true;
  if (r.intervalDays === 1) return false;
  return r.recurring === 'weekly' || r.recurring === 'monthly';
}

/**
 * Why a repeating task would sit on Today even with nothing pinned — or null
 * when the pin alone decides it.
 *
 * Lives here, beside the other schedule predicates, because both `showsOnDay`
 * and every pin control need it and none of them may re-derive it: a pin that
 * offers to change something the day's list ignores is a control that lies.
 */
export type FixedReason = 'daily' | 'anchor' | 'goal';

export function alwaysOnToday(r: Routine): FixedReason | null {
  if (!repeats(r)) return null;
  if (r.recurring === 'daily' && !r.intervalDays && !r.monthlyRule) return 'daily';
  if (r.anchor) return 'anchor';
  if (isGoalRoutine(r)) return 'goal';
  return null;
}

/** Is this task on Today right now — the state every pin renders and toggles.
 *  An explicit `offToday` beats every default. */
export const onToday = (r: Routine): boolean =>
  !isOffToday(r, logicalDateKey()) && (!!r.trackedToday || (matchesDueDay(r, logicalDateKey()) && (alwaysOnToday(r) !== null || !!r.dueDate || dueOnDay(r, logicalDayStart()))));

/** Manual pins override dates; dates alone only schedule their own day. */
export const matchesDueDay = (item: { dueDate?: string | null }, day: string): boolean =>
  !item.dueDate || item.dueDate.slice(0, 10) === day;

/** A deliberate unpin may suppress today's auto-pin, not a later deadline.
 * Older builds wrote an undated offToday by mistake during task creation.
 * Let dated items from those builds recover automatically on their due day. */
export function isOffToday(item: { offToday?: boolean; offTodayOn?: string; dueDate?: string | null }, day: string): boolean {
  if (!item.offToday) return false;
  if (item.dueDate?.slice(0, 10) === day) return item.offTodayOn === day;
  return true;
}

export const actionOnToday = (a: Action): boolean =>
  !a.offToday && (!!a.trackedToday || dueOnDay(a, logicalDayStart()));

/** A multi-day task you chip away at day by day — it has a counter target or a
 *  checklist. These surface on Today every day while open (that's the point),
 *  instead of hiding until the last day of their period. */
export function isGoalRoutine(r: Routine): boolean {
  return isMultiDayCycle(r) && (r.target != null || (r.subtasks?.length ?? 0) > 0);
}

// ── Sessions: counting days instead of taps ──────────────────────────────────
//
// "Go to the gym 3 times a week" and "drink 64 oz of water" look like the same
// counter and are not. The gym goal's unit of progress is a *day* — you can't go
// twice on Tuesday and be two-thirds done — while the water goal's unit is a
// quantity you can chip at all day. Modelling both as a bare number is why the
// gym goal could be completed from the sofa: three taps on Monday counted.
//
// So a session-mode task counts the days it happened on. One-per-day then holds
// by construction rather than by a guard, and every downstream number — the
// streak, the heatmap, the per-task history — starts telling the truth.

/**
 * Does this task count days rather than taps?
 *
 * Derived rather than stored when `oncePerDay` is unset, so existing tasks pick
 * up the right behaviour without anything rewriting their saved data: a
 * multi-day counter with no unit is counting occurrences ("3 times"), one with a
 * unit is counting quantity ("64 oz"). An explicit `oncePerDay` always wins.
 */
export function sessionMode(r: Routine): boolean {
  if (!isMultiDayCycle(r) || r.target == null) return false;
  return r.oncePerDay ?? !r.unit;
}

/** Was a session logged on this logical day? */
export const sessionOn = (r: Routine, dayKey: string): boolean =>
  (r.sessionDays ?? []).includes(dayKey);

/** How many days of the strip to draw before it stops being readable. A weekly
 *  goal is seven; a monthly one would be thirty, which is a heatmap, not a row. */
export const MAX_STRIP_DAYS = 14;

/**
 * The logical days making up this task's current cycle, ascending — the row the
 * session strip draws. Null when the cycle is too long to render as pips.
 *
 * Weeks are anchored to the logical week (Sunday 2am), matching the reset, so the
 * strip's last pip really is the day the cycle turns over. Intervals run from
 * their own `lastResetAt` instead, since that is what their reset measures from.
 */
export function cycleDayKeys(r: Routine, at: Date = new Date()): string[] | null {
  const span = (start: Date, days: number): string[] =>
    Array.from({ length: days }, (_, i) => dateKey(new Date(start.getTime() + i * 86_400_000)));

  if (r.intervalDays && r.intervalDays > 1) {
    if (r.intervalDays > MAX_STRIP_DAYS || !r.lastResetAt) return null;
    return span(logicalDayStart(new Date(r.lastResetAt)), r.intervalDays);
  }
  if (r.recurring === 'weekly') return span(logicalDayStart(thisWeekReset(at)), 7);
  return null;   // monthly and longer — thirty pips is a heatmap, not a row
}

/** Single-letter weekday headings for the strip, aligned to the keys above. */
export const dayInitial = (dayKey: string): string =>
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${dayKey}T12:00:00`).getDay()];

/** Local date key, e.g. '2026-06-12'. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Completion-log key for an instant, bucketed by logical (2am-rollover) day. */
export function logicalDateKey(d: Date = new Date()): string {
  return dateKey(logicalDayStart(d));
}

