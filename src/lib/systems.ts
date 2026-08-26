/**
 * System health: how reliably you are actually running a process.
 *
 * Deliberately *not* a completion percentage. A goal is either met or missed,
 * which is why goals discourage — the number tells you nothing you can act on
 * and spends most of its life at zero. Consistency over a trailing window has
 * the properties you want from a process metric: showing up moves it, one bad
 * day barely dents it, and a bad week is recoverable without starting over.
 *
 * Everything here is pure so it can be tested directly, and so the page can
 * render a number nobody had to store.
 */
import type { Routine, System } from '../types';
import { dateKey, historyOf, logicalDayStart, routineSystemIds, sessionMode, type TaskHistory } from '../store';

/** Trailing window the score is computed over. */
export const HEALTH_WINDOW_DAYS = 30;

/** How many days one turn of this habit's cycle takes. */
export function cycleDays(r: Routine): number {
  if (r.intervalDays && r.intervalDays > 0) return r.intervalDays;
  if (r.monthlyRule) return 30;
  switch (r.recurring) {
    case 'daily':   return 1;
    case 'weekly':  return 7;
    case 'monthly': return 30;
    default:        return 0;   // one-off: no cadence, so no consistency
  }
}

/** How many separate days one cycle asks of you. A session goal ("gym 3×")
 *  wants three days a week; everything else wants one per cycle. */
export const repsPerCycle = (r: Routine): number =>
  sessionMode(r) && r.target != null ? r.target : 1;

/** The day this habit started counting: when it was created, else the first day
 *  it was ever recorded. Scoring a habit over a month it did not exist for would
 *  punish you for adding it. */
function startDayKey(r: Routine, history: TaskHistory | undefined): string | null {
  if (r.createdAt) return dateKey(logicalDayStart(new Date(r.createdAt)));
  const days = historyOf(history, r.id);
  return days.length ? days.reduce((a, b) => (a < b ? a : b)) : null;
}

export interface HabitHealth {
  /** 0…1 — reps hit over reps expected, capped at 1. */
  rate: number;
  done: number;
  expected: number;
  /** Days the score actually covers (window, clipped to the habit's age). */
  days: number;
  streak: number;
}

/**
 * Consistency for one habit over the trailing window.
 *
 * Note what is *not* modelled: a skipped day still counts against you here,
 * because `taskHistory` records completions only and there is no stored record
 * of past skips to subtract. Rather than invent one, the number stays honest
 * about being a raw hit rate.
 */
export function habitHealth(
  r: Routine,
  history: TaskHistory | undefined,
  at: Date = new Date(),
): HabitHealth | null {
  const cycle = cycleDays(r);
  if (cycle <= 0) return null;                       // one-off — nothing to be consistent about

  const today     = logicalDayStart(at);
  const windowTop = dateKey(today);
  const floor     = dateKey(new Date(today.getTime() - (HEALTH_WINDOW_DAYS - 1) * 86_400_000));
  const start     = startDayKey(r, history);
  const from      = start && start > floor ? start : floor;

  const days = Math.round((new Date(`${windowTop}T12:00:00`).getTime()
                         - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;

  const done = historyOf(history, r.id).filter(d => d >= from && d <= windowTop).length;
  const expected = Math.max(1, Math.round((repsPerCycle(r) * days) / cycle));

  return {
    rate: Math.min(1, done / expected),
    done,
    expected,
    days,
    streak: r.streak ?? 0,
  };
}

// ── Never miss twice ─────────────────────────────────────────────────────────

/**
 * How close a daily habit is to breaking.
 *
 * The rule this exists for: missing once is an accident, missing twice is the
 * start of a new habit. The useful moment to say something is therefore the day
 * *after* a single miss — early enough to be a nudge, before it becomes a
 * verdict. `broken` is deliberately not a scolding state; it's the prompt to
 * restart, which is the only move available anyway.
 *
 * Daily habits only. "Twice" has no obvious meaning for a weekly goal, and
 * inventing one would put a warning on a task that is doing fine.
 */
export type MissState = 'ok' | 'at-risk' | 'broken';

export function missState(
  r: Routine,
  history: TaskHistory | undefined,
  at: Date = new Date(),
): MissState | null {
  if (r.recurring !== 'daily' || r.intervalDays || r.monthlyRule) return null;

  const today = logicalDayStart(at);
  const back  = (n: number) => dateKey(new Date(today.getTime() - n * 86_400_000));
  const days  = new Set(historyOf(history, r.id));

  // Today still has hours left in it, so today's absence is not yet a miss.
  if (days.has(back(0)) || days.has(back(1))) return 'ok';
  return days.has(back(2)) ? 'at-risk' : 'broken';
}

// ── Trend ────────────────────────────────────────────────────────────────────

/** Change in hit rate: the last 7 days against the 7 before them. */
export interface Trend {
  /** −1…1. Positive means you're running it more often than you were. */
  delta: number;
  recent: number;
  prior: number;
  /** False when there isn't enough history behind the habit to compare. */
  meaningful: boolean;
}

/**
 * Is this getting better or worse?
 *
 * The 30-day score answers "how am I doing", which is worth knowing but slow to
 * move — by design, since a metric that swung on one day would be a mood ring.
 * This answers the question the slow number can't: which direction am I going,
 * right now. Two 7-day windows is the shortest span that isn't just noise.
 */
export function habitTrend(
  r: Routine,
  history: TaskHistory | undefined,
  at: Date = new Date(),
): Trend | null {
  const cycle = cycleDays(r);
  if (cycle <= 0) return null;

  const today = logicalDayStart(at);
  const key   = (n: number) => dateKey(new Date(today.getTime() - n * 86_400_000));
  const days  = historyOf(history, r.id);
  const start = startDayKey(r, history);

  const windowRate = (from: number, to: number): number => {
    const lo = key(from), hi = key(to);
    const hits = days.filter(d => d >= lo && d <= hi).length;
    return Math.min(1, hits / Math.max(1, Math.round((repsPerCycle(r) * 7) / cycle)));
  };

  const recent = windowRate(6, 0);
  const prior  = windowRate(13, 7);
  return {
    delta: recent - prior,
    recent,
    prior,
    // Nothing to compare against until the habit has lived through both windows.
    meaningful: !!start && start <= key(13),
  };
}

/** System-level trend: the mean of its habits' deltas. */
export function systemTrend(
  routines: Routine[],
  history: TaskHistory | undefined,
  at: Date = new Date(),
): Trend | null {
  const ts = routines.map(r => habitTrend(r, history, at)).filter((t): t is Trend => t !== null);
  if (!ts.length) return null;
  const mean = (pick: (t: Trend) => number) => ts.reduce((a, t) => a + pick(t), 0) / ts.length;
  return {
    delta: mean(t => t.delta),
    recent: mean(t => t.recent),
    prior: mean(t => t.prior),
    meaningful: ts.some(t => t.meaningful),
  };
}

/** The habits belonging to a system, in display order. A habit can be in several
 *  systems, so it can legitimately appear under more than one of these lists. */
export const systemRoutines = (routines: Routine[], systemId: string): Routine[] =>
  routines.filter(r => routineSystemIds(r).includes(systemId) && !r.hidden);

export interface SystemHealth {
  /** 0…1, the mean of the member habits' rates. Null when nothing is scorable. */
  rate: number | null;
  /** Members that produced a score. One-offs are excluded rather than counted 0. */
  scored: number;
  total: number;
  /** Longest current streak among the members — the "still running" signal. */
  bestStreak: number;
}

/**
 * A system's health is the mean of its habits' consistency, not the fraction of
 * habits at 100%. Averaging keeps partial credit: three habits at 70% is a
 * system that is working, and a metric that reports that as 0/3 would be lying.
 */
export function systemHealth(
  routines: Routine[],
  history: TaskHistory | undefined,
  at: Date = new Date(),
): SystemHealth {
  const scores = routines.map(r => habitHealth(r, history, at)).filter((h): h is HabitHealth => h !== null);
  if (!scores.length) {
    return { rate: null, scored: 0, total: routines.length, bestStreak: 0 };
  }
  return {
    rate: scores.reduce((a, h) => a + h.rate, 0) / scores.length,
    scored: scores.length,
    total: routines.length,
    bestStreak: scores.reduce((a, h) => Math.max(a, h.streak), 0),
  };
}

// A `healthLabel` used to put a word on the rate — Running / Holding / Slipping
// / Stalled. Removed: the number already says how consistent you have been, and
// grading it is a judgement the app was making on your behalf.

/** Colour for a rate. Deliberately not red-at-the-bottom: a stalled system is
 *  information, not a failure notice, and the point of the tab is to make
 *  restarting feel ordinary. */
export function healthHex(rate: number | null): string {
  if (rate == null) return 'var(--text-dim)';
  if (rate >= 0.85) return '#34d399';
  if (rate >= 0.6)  return '#fbbf24';
  if (rate >= 0.3)  return '#fb923c';
  return '#94a3b8';
}

/** Systems in display order: manual `order` first, then creation. */
export const orderedSystems = (systems: System[]): System[] =>
  [...systems].filter(s => !s.hidden).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
