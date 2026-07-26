import type { MonthlyRule, DayKind, NthPosition } from '../types';

/**
 * Calendar-style "nth weekday of the month" recurrence — the pattern every
 * calendar app offers and a plain day-interval can't express: "first Monday",
 * "last weekday", "second weekend day", "third Friday of every 2 months".
 *
 * A rule always resolves to exactly ONE date per active month (that's what
 * "the first weekday of the month" means), which keeps the reset/streak logic
 * identical in shape to the interval cadences it sits beside.
 *
 * All maths here is on *local* dates at midnight. The 5am logical-day rollover
 * is applied by the callers in store.ts, which hand in an already-normalised
 * day start — doing it in both places would shift every occurrence by a day.
 */

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Does this date satisfy the rule's day-kind? */
function matchesKind(d: Date, kind: DayKind): boolean {
  const day = d.getDay();
  if (kind === 'day') return true;
  if (kind === 'weekday') return day >= 1 && day <= 5;
  if (kind === 'weekend') return day === 0 || day === 6;
  return day === WEEKDAY_INDEX[kind];
}

/** Number of days in a given month (month is 0-based). */
const daysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

/** Absolute month index, so "every N months" can be measured without date maths. */
const monthIndex = (year: number, month: number): number => year * 12 + month;

/**
 * Is this month one the rule fires in? Every month unless `months` > 1, in which
 * case it counts from `anchorMonth` — the month the rule was set. Anchoring on a
 * stored month (rather than, say, the epoch) is what makes "every 2 months" land
 * on the months the user actually picked it in.
 */
function monthActive(year: number, month: number, rule: MonthlyRule): boolean {
  const step = rule.months && rule.months > 1 ? rule.months : 1;
  if (step === 1) return true;
  const anchor = rule.anchorMonth ?? 0;
  return (((monthIndex(year, month) - anchor) % step) + step) % step === 0;
}

/**
 * The single date this rule resolves to in the given month, ignoring whether the
 * month is active. Null only in cases that can't occur with nth ≤ 4 (every month
 * holds at least four of every weekday), but handled rather than assumed.
 */
export function occurrenceInMonth(year: number, month: number, rule: MonthlyRule): Date | null {
  const total = daysInMonth(year, month);

  if (rule.nth === -1) {
    for (let day = total; day >= 1; day--) {
      const d = new Date(year, month, day);
      if (matchesKind(d, rule.kind)) return d;
    }
    return null;
  }

  let seen = 0;
  for (let day = 1; day <= total; day++) {
    const d = new Date(year, month, day);
    if (matchesKind(d, rule.kind)) {
      seen++;
      if (seen === rule.nth) return d;
    }
  }
  return null;
}

/** Does the rule fire on this exact (logical) day? */
export function occursOn(dayStart: Date, rule: MonthlyRule): boolean {
  const year = dayStart.getFullYear();
  const month = dayStart.getMonth();
  if (!monthActive(year, month, rule)) return false;
  const occ = occurrenceInMonth(year, month, rule);
  return !!occ && occ.getDate() === dayStart.getDate();
}

/** Walk back this many months before giving up — comfortably past any real
 *  `months` interval, and bounded so a malformed rule can't spin forever. */
const LOOKBACK_MONTHS = 72;

/** The most recent occurrence on or before `at`, or null if none within range. */
export function lastOccurrenceOnOrBefore(at: Date, rule: MonthlyRule): Date | null {
  let year = at.getFullYear();
  let month = at.getMonth();
  for (let i = 0; i < LOOKBACK_MONTHS; i++) {
    if (monthActive(year, month, rule)) {
      const occ = occurrenceInMonth(year, month, rule);
      if (occ && occ.getTime() <= at.getTime()) return occ;
    }
    month--;
    if (month < 0) { month = 11; year--; }
  }
  return null;
}

/** The next occurrence strictly after `at`, or null if none within range. */
export function nextOccurrenceAfter(at: Date, rule: MonthlyRule): Date | null {
  let year = at.getFullYear();
  let month = at.getMonth();
  for (let i = 0; i < LOOKBACK_MONTHS; i++) {
    if (monthActive(year, month, rule)) {
      const occ = occurrenceInMonth(year, month, rule);
      if (occ && occ.getTime() > at.getTime()) return occ;
    }
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return null;
}

// ── Labels ────────────────────────────────────────────────────────────────────

export const NTH_LABEL: Record<NthPosition, string> = {
  1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', [-1]: 'Last',
};

/** Compact ordinal for badges — "1st", "2nd", "Last". */
const NTH_SHORT: Record<NthPosition, string> = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'Last',
};

export const KIND_LABEL: Record<DayKind, string> = {
  day: 'day', weekday: 'weekday', weekend: 'weekend day',
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

const KIND_SHORT: Record<DayKind, string> = {
  day: 'day', weekday: 'weekday', weekend: 'weekend',
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed',
  thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

/** Full sentence form — "First Monday of every 2 months". */
export function monthlyRuleLabel(rule: MonthlyRule): string {
  const step = rule.months && rule.months > 1 ? rule.months : 1;
  const when = `${NTH_LABEL[rule.nth]} ${KIND_LABEL[rule.kind]}`;
  return step === 1 ? `${when} of the month` : `${when} of every ${step} months`;
}

/** Compact badge form — "1st Monday", "Last weekday · every 2mo". */
export function monthlyRuleShort(rule: MonthlyRule): string {
  const step = rule.months && rule.months > 1 ? rule.months : 1;
  const when = `${NTH_SHORT[rule.nth]} ${KIND_SHORT[rule.kind]}`;
  return step === 1 ? when : `${when} · every ${step}mo`;
}

/** Current absolute month index — stamped as the anchor when a rule is created. */
export const currentMonthIndex = (d: Date = new Date()): number =>
  monthIndex(d.getFullYear(), d.getMonth());
