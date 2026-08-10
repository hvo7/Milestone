import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Questline, Quest, Action, GuildColor, RecurringType, Routine, Subtask, Schedule, MonthlyRule } from './types';
import { sampleData } from './data/sampleData';
import { migrateLegacyStorage } from './lib/storageMigration';
import { flattenTree, mapTree, mapNode, insertNode, removeNode } from './lib/subtree';
import {
  occursOn, lastOccurrenceOnOrBefore, nextOccurrenceAfter,
  monthlyRuleLabel, monthlyRuleShort,
} from './lib/monthlyRule';

/** localStorage keys. Renaming one strands every user's data under the old key —
 *  see lib/storageMigration.ts, which carries the pre-Milestone keys forward. */
export const QUEST_STORE_KEY = 'milestone-v1';
export const UI_STORE_KEY    = 'milestone-ui';

// Must run before the stores below are created: `persist` reads its key the moment
// the store is constructed, so a late migration would be read after the fact.
migrateLegacyStorage();

function uid() { return Math.random().toString(36).slice(2, 10); }

/** Counter config passed when creating a task as a counter (target/step/unit). */
export interface CounterConfig { target: number; step?: number; unit?: string; }

// ── Immutable nested updates ──────────────────────────────────────────────────
// Quest data nests three deep (questline → quest → action) and nearly every action
// below rewrites a single node at one of those levels. Spelling the walk out each
// time buried the actual change in identical map/ternary scaffolding — and each
// hand-written copy was a chance to drop a sibling. These say it once.

const mapById = <T extends { id: string }>(list: T[], id: string, fn: (item: T) => T): T[] =>
  list.map(item => (item.id === id ? fn(item) : item));

const mapQuest = (qls: Questline[], qlId: string, qId: string, fn: (q: Quest) => Quest): Questline[] =>
  mapById(qls, qlId, ql => ({ ...ql, quests: mapById(ql.quests, qId, fn) }));

const mapAction = (qls: Questline[], qlId: string, qId: string, aId: string, fn: (a: Action) => Action): Questline[] =>
  mapQuest(qls, qlId, qId, q => ({ ...q, actions: mapById(q.actions, aId, fn) }));

const findQuest = (qls: Questline[], qlId: string, qId: string): Quest | undefined =>
  qls.find(ql => ql.id === qlId)?.quests.find(q => q.id === qId);

/** Did a schedule edit actually change the cadence? The repeat pickers re-emit on
 *  every click, so each setter compares before writing — re-picking the current
 *  cadence must not restart the reset clock and wipe the streak. */
const scheduleChanged = (prev: Schedule, next: Pick<Schedule, 'recurring' | 'intervalDays' | 'monthlyRule'>): boolean =>
  (next.recurring ?? null) !== (prev.recurring ?? null)
  || (next.intervalDays || undefined) !== (prev.intervalDays || undefined)
  || !sameRule(next.monthlyRule ?? null, prev.monthlyRule);

/** Daily tasks auto-pin to Today; a custom interval or calendar rule doesn't. */
const autoPins = (s: Pick<Schedule, 'recurring' | 'intervalDays' | 'monthlyRule'>): boolean =>
  s.recurring === 'daily' && !s.intervalDays && !s.monthlyRule;

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function isQuestUnlocked(questline: Questline, quest: Quest): boolean {
  if (!questline.sequential) return true;
  if (quest.order === 1) return true;
  const prev = questline.quests.find(q => q.order === quest.order - 1);
  if (!prev) return false;
  // Unlock once the previous quest is complete — via its sub-tasks, or (when it
  // has none) via its own completion flag. isQuestComplete captures both.
  return isQuestComplete(prev);
}

export function isQuestComplete(quest: Quest): boolean {
  const visible = quest.actions.filter(a => !a.hidden);
  // A quest with sub-tasks is done when they all are; an action-less quest falls
  // back to its own `completed` flag (set by checking it off directly on Today).
  if (visible.length === 0) return !!quest.completed;
  return visible.every(a => a.completed);
}

export function isCycleComplete(quest: Quest): boolean {
  return !!quest.recurring && isQuestComplete(quest);
}

export function isRoutineComplete(routine: Routine): boolean {
  return routine.completed;
}

export function getActiveQuest(questline: Questline): Quest | null {
  const sorted = [...questline.quests].filter(q => !q.hidden).sort((a, b) => a.order - b.order);
  if (questline.sequential) {
    return sorted.find(q => isQuestUnlocked(questline, q) && !isQuestComplete(q)) ?? null;
  }
  const incomplete = sorted.filter(q => !isQuestComplete(q));
  if (!incomplete.length) return null;
  return incomplete.reduce((best, q) => {
    const bv = best.actions.filter(a => !a.hidden);
    const qv = q.actions.filter(a => !a.hidden);
    const bd = bv.filter(a => a.completed).length / Math.max(1, bv.length);
    const qd = qv.filter(a => a.completed).length / Math.max(1, qv.length);
    return qd > bd ? q : best;
  });
}

export function questlineProgress(questline: Questline): { done: number; total: number } {
  const visible = questline.quests.filter(q => !q.hidden);
  return { done: visible.filter(isQuestComplete).length, total: visible.length };
}

export function questProgress(quest: Quest): { done: number; total: number } {
  const visible = quest.actions.filter(a => !a.hidden);
  return { done: visible.filter(a => a.completed).length, total: visible.length };
}


/** Human label for a recurrence. A calendar rule wins, then a custom interval,
 *  then the plain cadence — e.g. "1st Monday", "Every 3 weeks", "Daily". */
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
 *  late-night work (after 12am but before 5am) still counts toward the day that
 *  just ended rather than triggering an early reset. */
export const DAY_RESET_HOUR = 5;

/** Midnight of the *logical* day an instant belongs to. Times before
 *  DAY_RESET_HOUR count as the previous calendar day. */
export function logicalDayStart(d: Date = new Date()): Date {
  const x = new Date(d.getTime() - DAY_RESET_HOUR * 3_600_000);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** The next daily rollover instant — DAY_RESET_HOUR on the morning that ends
 *  the current logical day. */
function nextDailyReset(): Date {
  const d = logicalDayStart();
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
 *  on the last day of the logical week (Saturday, since weeks reset Sunday 5am);
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
    // Due once the 30-day mark lands before this logical day's 5am rollover.
    return new Date(lastResetAt).getTime() + MONTHLY_MS < dayStart.getTime() + 86_400_000 + DAY_RESET_HOUR * 3_600_000;
  }
  return false;
}

/**
 * Is this routine's skip still in force?
 *
 * A skip excuses exactly the *day* it was made — every task, every cadence. It
 * lapses at the next 5am rollover and the task simply comes back. (Skips used to
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

/** A multi-day task you chip away at day by day — it has a counter target or a
 *  checklist. These surface on Today every day while open (that's the point),
 *  instead of hiding until the last day of their period. */
export function isGoalRoutine(r: Routine): boolean {
  return isMultiDayCycle(r) && (r.target != null || (r.subtasks?.length ?? 0) > 0);
}

/** Every node of a (possibly nested) subtask tree, flattened. */
export const flattenSubtasks = (list: Subtask[] | undefined): Subtask[] => flattenTree(list);

/** Done/total across the whole subtask tree. */
export function subtaskStats(list: Subtask[] | undefined): { done: number; total: number } {
  const all = flattenSubtasks(list);
  return { done: all.filter(st => st.completed).length, total: all.length };
}

/** Set completion on a node and everything under it (checking a parent checks the branch). */
function setSubtreeCompleted(st: Subtask, completed: boolean, now: string): Subtask {
  return {
    ...st,
    completed,
    completedAt: completed ? (st.completedAt ?? now) : undefined,
    children: st.children?.map(c => setSubtreeCompleted(c, completed, now)),
  };
}

/** Uncheck the whole tree (new cycle). */
const resetSubtaskTree = (list: Subtask[] | undefined): Subtask[] | undefined =>
  mapTree(list, st => ({ ...st, completed: false, completedAt: undefined }));

/** Did this multi-day task see real progress on `dayKey`? Counts a completion,
 *  a counter increment, or any subtask checked that day. */
export function engagedOnDay(r: Routine, dayKey: string): boolean {
  const on = (iso?: string) => !!iso && logicalDateKey(new Date(iso)) === dayKey;
  if (on(r.completedAt)) return true;
  if (on(r.lastProgressAt)) return true;
  return flattenSubtasks(r.subtasks).some(st => st.completed && on(st.completedAt));
}

/** How much heatmap credit a routine holds for `dayKey` right now (0 or 1).
 *  Daily/one-time tasks earn it by completing; multi-day goals earn it by showing
 *  up — a session logged today counts even though the cycle is still open. A
 *  skipped day holds no credit regardless. Mutations bump the completion log by
 *  the *difference* in this value, so no path can double-count a day. */
function dayCredit(r: Routine, dayKey: string): number {
  if (skipActive(r, dayKey)) return 0;
  if (isMultiDayCycle(r)) return r.completed || engagedOnDay(r, dayKey) ? 1 : 0;
  return r.completed ? 1 : 0;
}

function clearActions(actions: Action[]): Action[] {
  return actions.map(a => ({ ...a, completed: false, trackedToday: false }));
}

/** Normalise a CounterConfig into the routine fields it sets (or nothing). */
function counterFields(counter?: CounterConfig): Partial<Routine> {
  if (!counter || !(counter.target > 0)) return {};
  return {
    target: Math.floor(counter.target),
    progress: 0,
    ...(counter.step && counter.step > 1 ? { step: Math.floor(counter.step) } : {}),
    ...(counter.unit?.trim() ? { unit: counter.unit.trim() } : {}),
  };
}

function processQuestlines(questlines: Questline[]): Questline[] {
  const now = new Date().toISOString();
  return questlines.map(ql => {
    // Questline-level reset
    if (ql.recurring && periodExpired(ql)) {
      const { done, total } = questlineProgress(ql);
      return {
        ...ql, lastResetAt: now,
        streak: (done === total && total > 0) ? (ql.streak ?? 0) + 1 : 0,
        quests: ql.quests.map(q => ({ ...q, actions: clearActions(q.actions), completed: false, lastResetAt: now })),
      };
    }
    let out = ql;
    if (ql.recurring && !ql.lastResetAt) out = { ...ql, lastResetAt: now, streak: 0 };

    // Quest + action level resets
    return {
      ...out,
      quests: out.quests.map(quest => {
        if (quest.recurring) {
          if (!quest.lastResetAt) return { ...quest, lastResetAt: now, streak: 0 };
          if (periodExpired(quest)) {
            const wasComplete = isQuestComplete(quest);
            return { ...quest, actions: clearActions(quest.actions), completed: false, lastResetAt: now, streak: wasComplete ? (quest.streak ?? 0) + 1 : 0 };
          }
          return quest;
        }
        return {
          ...quest,
          actions: quest.actions.map(a => {
            if (!a.recurring && !a.intervalDays && !a.monthlyRule) return a;
            if (!a.lastResetAt) return { ...a, lastResetAt: now };
            if (periodExpired(a)) return { ...a, completed: false, trackedToday: a.recurring === 'daily', lastResetAt: now };
            return a;
          }),
        };
      }),
    };
  });
}

function processRoutines(routines: Routine[]): Routine[] {
  const now = new Date().toISOString();
  return routines.map(r => {
    // Daily tasks auto-pin to Today; custom-interval ones (e.g. every 3 weeks) don't.
    const autoTrack = r.recurring === 'daily' && !r.intervalDays;
    // Migrate routines saved before the schema change (completed/trackedToday may be undefined)
    const base: Routine = {
      ...r,
      completed:    r.completed    ?? false,
      trackedToday: r.trackedToday ?? autoTrack,
    };

    if (!base.lastResetAt) return { ...base, lastResetAt: now, streak: base.streak ?? 0 };

    // Every routine recurs and persists until deleted: when its period rolls over it
    // resets to incomplete and extends (or breaks) its streak. General maintenance,
    // anchor habits and quest-linked tasks all share this behaviour now.
    if (periodExpired(base)) {
      const wasComplete = base.completed;
      // A skipped day is neutral — the streak survives untouched. Only a real miss
      // (never completed, never excused) breaks it. `skippedInCycle` remembers a
      // mid-cycle skip whose day-scoped `skippedOn` already lapsed.
      const wasSkipped = !!base.skippedOn || !!base.skippedInCycle;
      return {
        ...base,
        completed: false,
        completedAt: undefined,
        skippedOn: undefined,
        skippedInCycle: undefined,
        lastProgressAt: undefined,
        trackedToday: autoTrack,
        lastResetAt: now,
        streak: wasComplete ? (base.streak ?? 0) + 1 : wasSkipped ? (base.streak ?? 0) : 0,
        // Counter tasks start the new cycle back at zero.
        progress: base.target != null ? 0 : base.progress,
        subtasks: resetSubtaskTree(base.subtasks),
      };
    }

    // Skips are day-scoped for every cadence now, so any skip whose day has ended is
    // retired here (mid-cycle for repeating tasks, next morning for one-offs). A skip
    // that outlived its day would keep the task sunk to the bottom of Today and out
    // of the progress bar indefinitely.
    if (base.skippedOn && !skipActive(base)) return { ...base, skippedOn: undefined };

    return base;
  });
}

// ── Completion log (heatmap) ─────────────────────────────────────────────────

/** Local date key, e.g. '2026-06-12'. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Completion-log key for an instant, bucketed by logical (5am-rollover) day. */
export function logicalDateKey(d: Date = new Date()): string {
  return dateKey(logicalDayStart(d));
}

function bumpLog(log: Record<string, number>, delta: number): Record<string, number> {
  const key = logicalDateKey();
  const next = Math.max(0, (log[key] ?? 0) + delta);
  return { ...log, [key]: next };
}

/** Apply `mutate` to one routine and settle its heatmap credit for today: the
 *  completion log moves by the *difference* in dayCredit, so every path into a
 *  routine (checkbox, counter tap, subtask, skip) counts a day at most once. */
function mutateRoutine(
  s: { routines: Routine[]; completionLog: Record<string, number> },
  rId: string,
  mutate: (r: Routine) => Routine,
): Partial<{ routines: Routine[]; completionLog: Record<string, number> }> {
  const r0 = s.routines.find(r => r.id === rId);
  if (!r0) return {};
  const key = logicalDateKey();
  const r1 = mutate(r0);
  const diff = dayCredit(r1, key) - dayCredit(r0, key);
  return {
    routines: s.routines.map(r => (r.id === rId ? r1 : r)),
    completionLog: diff === 0 ? s.completionLog : bumpLog(s.completionLog, diff),
  };
}

// ── One-time task archive ─────────────────────────────────────────────────────

/** Days a completed one-time General task rests in the All tab's Archived section
 *  before it's deleted automatically. */
export const ARCHIVE_RETENTION_DAYS = 14;

/** A completed one-time General task is "archived": it stays in its group (checked,
 *  at the bottom) through the day it was completed, then moves to the All tab's
 *  Archived section the next logical day, where it waits out its retention window. */
export function isArchivedRoutine(r: Routine, todayKey: string = logicalDateKey()): boolean {
  if (r.recurring || r.intervalDays) return false;
  if (r.questlineId || r.anchor) return false;
  if (!r.completed || !r.completedAt) return false;
  return logicalDateKey(new Date(r.completedAt)) < todayKey;
}

/** Archived tasks are deleted for good once ARCHIVE_RETENTION_DAYS logical days
 *  have passed since completion. Runs inside the periodic reset pass. */
function purgeExpiredArchive(routines: Routine[]): Routine[] {
  const cutoff = logicalDayStart().getTime() - ARCHIVE_RETENTION_DAYS * 86_400_000;
  return routines.filter(r =>
    !(isArchivedRoutine(r) && logicalDayStart(new Date(r.completedAt!)).getTime() <= cutoff));
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface QuestData {
  questlines: Questline[];
  routines: Routine[];
  /** Tasks completed per local day, keyed 'YYYY-MM-DD'. Drives the heatmap. */
  completionLog: Record<string, number>;
  /** Manual order for the unified Today "To Do" list, keyed by task id. */
  todoOrder: Record<string, number>;

  checkAndResetRecurring: () => void;

  // Quest data
  toggleAction:       (qlId: string, qId: string, aId: string) => void;
  toggleTracked:      (qlId: string, qId: string, aId: string) => void;
  /** Pin (or unpin) a *quest itself* to the Today list. The quest shows there as
   *  one item with its actions as check-off steps — the way to track a quest as a
   *  unit, and the only way to put an action-less quest on Today. */
  toggleQuestTracked: (qlId: string, qId: string) => void;
  /** Check/uncheck a whole quest from Today: completes (or reopens) all its
   *  actions, or toggles its own flag when it has none. Heatmap-aware. */
  setQuestComplete:   (qlId: string, qId: string, complete: boolean) => void;
  toggleActionHidden: (qlId: string, qId: string, aId: string) => void;
  setActionRecurring: (qlId: string, qId: string, aId: string, r: RecurringType | null, intervalDays?: number, monthlyRule?: MonthlyRule | null) => void;

  toggleQuestHidden:  (qlId: string, qId: string) => void;
  setQuestRecurring:  (qlId: string, qId: string, r: RecurringType | null) => void;
  setQuestDueDate:    (qlId: string, qId: string, dueDate: string | null) => void;
  addAction:          (qlId: string, qId: string, title: string) => void;
  deleteAction:       (qlId: string, qId: string, aId: string) => void;

  toggleQuestlineHidden: (qlId: string) => void;
  addQuestline:       (title: string, desc: string, icon: string, color: GuildColor) => void;
  updateQuestline:    (qlId: string, updates: Partial<Pick<Questline,'title'|'description'|'icon'|'color'|'sequential'|'recurring'>>) => void;
  addQuest:           (qlId: string, title: string, desc: string, recurring: RecurringType | null, dueDate: string | null, monthlyRule?: MonthlyRule | null) => void;
  updateQuestTitle:   (qlId: string, qId: string, title: string) => void;
  updateQuest:        (qlId: string, qId: string, updates: Partial<Pick<Quest,'title'|'description'|'recurring'|'dueDate'|'intervalDays'|'monthlyRule'>>) => void;
  moveQuest:          (fromQlId: string, toQlId: string, qId: string) => void;
  deleteQuestline:    (qlId: string) => void;
  deleteQuest:        (qlId: string, qId: string) => void;
  reorderQuests:      (qlId: string, orderedIds: string[]) => void;

  // Routines
  addRoutine:           (title: string, desc: string, recurring: RecurringType | null, questlineId?: string, intervalDays?: number, questId?: string, dueDate?: string | null, counter?: CounterConfig, monthlyRule?: MonthlyRule | null) => void;
  /** Set/clear a one-time task's due date ('YYYY-MM-DD' or null). */
  setRoutineDueDate:    (rId: string, dueDate: string | null) => void;
  /** Add a habit to the highlighted anchor-habit category (Today tab). */
  addAnchorRoutine:     (title: string, recurring: 'daily' | 'weekly', counter?: CounterConfig) => void;
  /** Nudge a counter task's progress by `delta` (clamped to 0…target); auto-completes at target. */
  incrementRoutine:     (rId: string, delta: number) => void;
  /** Toggle "skipped today" on a recurring task — a neutral day that earns no heatmap
   *  credit but preserves the streak (e.g. a walk on a rainy day). It returns next period. */
  skipRoutine:          (rId: string) => void;
  /** Change a routine's cadence (null = one-time) and optional custom interval in days. */
  setRoutineRecurring:  (rId: string, recurring: RecurringType | null, intervalDays?: number, monthlyRule?: MonthlyRule | null) => void;
  deleteRoutine:        (rId: string) => void;
  /** Manual display order for the unified Today "To Do" list, keyed by task id. */
  reorderTodo:          (orderedIds: string[]) => void;
  setRoutineQuest:      (rId: string, questId: string | null) => void;
  /** Add a subtask; pass `parentSubId` to nest it under an existing step (any depth). */
  addRoutineSubtask:    (rId: string, title: string, parentSubId?: string | null) => void;
  toggleRoutineSubtask: (rId: string, sId: string) => void;
  renameRoutineSubtask: (rId: string, sId: string, title: string) => void;
  deleteRoutineSubtask: (rId: string, sId: string) => void;
  /** Patch any of a routine's editable fields at once (the full edit panel).
   *  Passing `counter: null` removes counter mode; `counter` set (re)configures it.
   *  Changing the cadence restarts the reset clock, like setRoutineRecurring. */
  updateRoutine:        (rId: string, updates: {
    title?: string; description?: string;
    recurring?: RecurringType | null; intervalDays?: number; monthlyRule?: MonthlyRule | null;
    dueDate?: string | null;
    questlineId?: string | null; questId?: string | null; anchor?: boolean;
    counter?: CounterConfig | null;
  }) => void;
  toggleRoutine:        (rId: string) => void;
  toggleRoutineTracked: (rId: string) => void;
  toggleRoutineHidden:  (rId: string) => void;
  updateRoutineTitle:      (rId: string, title: string) => void;
  updateActionTitle:       (qlId: string, qId: string, aId: string, title: string) => void;
  setRoutineCompleted:     (rId: string, completed: boolean) => void;
  setAllActionsComplete:   (qlId: string, qId: string, complete: boolean) => void;
}

export const useQuestStore = create<QuestData>()(
  persist(
    (set) => ({
      questlines: sampleData,
      routines: [],
      completionLog: {},
      todoOrder: {},

      checkAndResetRecurring: () =>
        set(s => ({ questlines: processQuestlines(s.questlines), routines: processRoutines(purgeExpiredArchive(s.routines)) })),

      toggleAction: (qlId, qId, aId) =>
        set(s => {
          const was = findQuest(s.questlines, qlId, qId)?.actions.find(a => a.id === aId)?.completed ?? false;
          return {
            questlines: mapAction(s.questlines, qlId, qId, aId, a => ({ ...a, completed: !a.completed })),
            completionLog: bumpLog(s.completionLog, was ? -1 : 1),
          };
        }),

      toggleTracked: (qlId, qId, aId) =>
        set(s => ({ questlines: mapAction(s.questlines, qlId, qId, aId, a => ({ ...a, trackedToday: !a.trackedToday })) })),

      toggleQuestTracked: (qlId, qId) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, trackedToday: !q.trackedToday })) })),

      // Checking a quest off Today completes its whole checklist at once (or, for an
      // action-less quest, flips its own flag). The heatmap moves by the number of
      // sub-tasks that actually changed state, so it stays consistent with ticking
      // those actions one by one — a quest of 3 tasks counts as 3, not 1.
      setQuestComplete: (qlId, qId, complete) =>
        set(s => {
          const quest = findQuest(s.questlines, qlId, qId);
          if (!quest) return {};
          const visible = quest.actions.filter(a => !a.hidden);
          let delta: number;
          let nextQuest: Quest;
          if (visible.length === 0) {
            if (!!quest.completed === complete) return {};   // no change
            delta = complete ? 1 : -1;
            nextQuest = { ...quest, completed: complete };
          } else {
            const before = visible.filter(a => a.completed).length;
            const after  = complete ? visible.length : 0;
            delta = after - before;
            nextQuest = { ...quest, actions: quest.actions.map(a => a.hidden ? a : { ...a, completed: complete }) };
          }
          return {
            questlines: mapQuest(s.questlines, qlId, qId, () => nextQuest),
            completionLog: delta === 0 ? s.completionLog : bumpLog(s.completionLog, delta),
          };
        }),

      toggleActionHidden: (qlId, qId, aId) =>
        set(s => ({ questlines: mapAction(s.questlines, qlId, qId, aId, a => ({ ...a, hidden: !a.hidden })) })),

      setActionRecurring: (qlId, qId, aId, r, intervalDays, monthlyRule) =>
        set(s => ({ questlines: mapAction(s.questlines, qlId, qId, aId, a => {
          const next = { recurring: r ?? null, intervalDays: intervalDays || undefined, monthlyRule: monthlyRule ?? null };
          if (!scheduleChanged(a, next)) return a;
          return {
            ...a, ...next,
            trackedToday: autoPins(next) ? true : a.trackedToday,
            lastResetAt: repeats(next) ? new Date().toISOString() : undefined,
          };
        }) })),

      toggleQuestHidden: (qlId, qId) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, hidden: !q.hidden })) })),

      setQuestRecurring: (qlId, qId, r) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, recurring: r ?? null, lastResetAt: r ? new Date().toISOString() : undefined, streak: r ? (q.streak ?? 0) : undefined })) })),

      setQuestDueDate: (qlId, qId, dueDate) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, dueDate: dueDate ?? null })) })),

      addAction: (qlId, qId, title) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, actions: [...q.actions, { id: `a-${uid()}`, title, completed: false, trackedToday: false }] })) })),

      deleteAction: (qlId, qId, aId) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, actions: q.actions.filter(a => a.id !== aId) })) })),

      toggleQuestlineHidden: (qlId) =>
        set(s => ({ questlines: mapById(s.questlines, qlId, ql => ({ ...ql, hidden: !ql.hidden })) })),

      addQuestline: (title, desc, icon, color) =>
        set(s => ({ questlines: [...s.questlines, { id: `ql-${uid()}`, title, description: desc, icon, color, quests: [], sequential: false }] })),

      updateQuestline: (qlId, updates) =>
        set(s => ({
          questlines: mapById(s.questlines, qlId, ql => {
            const nextRecurring = updates.recurring !== undefined ? (updates.recurring ?? null) : (ql.recurring ?? null);
            // Treat undefined and null alike (both "not recurring") so saving the edit
            // modal without touching recurrence doesn't reset the clock/streak.
            const recurringChanged = nextRecurring !== (ql.recurring ?? null);
            return {
              ...ql, ...updates,
              recurring: nextRecurring,
              lastResetAt: recurringChanged ? (nextRecurring ? new Date().toISOString() : undefined) : ql.lastResetAt,
              streak: recurringChanged ? (nextRecurring ? (ql.streak ?? 0) : undefined) : ql.streak,
            };
          }),
        })),

      addQuest: (qlId, title, desc, recurring, dueDate, monthlyRule) =>
        set(s => ({
          questlines: mapById(s.questlines, qlId, ql => {
            const q: Quest = { id: `q-${uid()}`, title, description: desc, order: ql.quests.length + 1, actions: [], recurring: recurring ?? null, ...(monthlyRule ? { monthlyRule } : {}), lastResetAt: (recurring || monthlyRule) ? new Date().toISOString() : undefined, streak: 0, dueDate: monthlyRule ? null : (dueDate ?? null) };
            return { ...ql, quests: [...ql.quests, q] };
          }),
        })),

      updateQuestTitle: (qlId, qId, title) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, title })) })),

      // Patch any of a quest's own fields at once (used by the create/edit drawer).
      // Mirrors setQuestRecurring's reset semantics: changing the cadence restarts
      // its reset clock + streak; leaving it untouched preserves them.
      updateQuest: (qlId, qId, updates) =>
        set(s => ({
          questlines: mapQuest(s.questlines, qlId, qId, q => {
            const nextRecurring = updates.recurring !== undefined ? (updates.recurring ?? null) : (q.recurring ?? null);
            const nextRule = updates.monthlyRule !== undefined ? (updates.monthlyRule ?? null) : (q.monthlyRule ?? null);
            const changed = nextRecurring !== (q.recurring ?? null) || !sameRule(nextRule, q.monthlyRule);
            const stillRepeats = !!nextRecurring || !!nextRule;
            return {
              ...q, ...updates,
              recurring: nextRecurring,
              monthlyRule: nextRule,
              // A calendar rule owns the date, so it clears any one-off due date.
              dueDate: nextRule ? null : (updates.dueDate !== undefined ? (updates.dueDate ?? null) : q.dueDate),
              lastResetAt: changed ? (stillRepeats ? new Date().toISOString() : undefined) : q.lastResetAt,
              streak: changed ? (stillRepeats ? (q.streak ?? 0) : undefined) : q.streak,
            };
          }),
        })),

      // Reassign a quest to a different questline (append at the end, renumber both).
      moveQuest: (fromQlId, toQlId, qId) =>
        set(s => {
          if (fromQlId === toQlId) return {};
          const quest = s.questlines.find(ql => ql.id === fromQlId)?.quests.find(q => q.id === qId);
          if (!quest) return {};
          return {
            questlines: s.questlines.map(ql => {
              if (ql.id === fromQlId) return { ...ql, quests: ql.quests.filter(q => q.id !== qId).map((q, i) => ({ ...q, order: i + 1 })) };
              if (ql.id === toQlId)   return { ...ql, quests: [...ql.quests, { ...quest, order: ql.quests.length + 1 }] };
              return ql;
            }),
          };
        }),

      deleteQuestline: (qlId) =>
        // Removing a questline also removes its nested quests/actions (they live inside it)
        // and any standalone routines linked to it, so nothing is orphaned in the Today list.
        set(s => ({
          questlines: s.questlines.filter(ql => ql.id !== qlId),
          routines: s.routines.filter(r => r.questlineId !== qlId),
        })),

      deleteQuest: (qlId, qId) =>
        set(s => ({
          questlines: mapById(s.questlines, qlId, ql => ({ ...ql, quests: ql.quests.filter(q => q.id !== qId).map((q, i) => ({ ...q, order: i + 1 })) })),
          // Detach (but keep) any linked tasks that pointed at the deleted quest.
          routines: s.routines.map(r => r.questId === qId ? { ...r, questId: undefined } : r),
        })),

      reorderQuests: (qlId, orderedIds) =>
        set(s => ({
          questlines: mapById(s.questlines, qlId, ql => {
            // Callers that reorder a *filtered* view (the Quests tab hides hidden
            // quests, and hoists the active one out of the list) can only name the
            // ids they rendered. Anything unnamed keeps its relative order and is
            // appended rather than dropped — this used to rebuild `quests` from
            // orderedIds alone, which deleted every omitted quest.
            const named = new Set(orderedIds);
            const ids = [
              ...orderedIds.filter(id => ql.quests.some(q => q.id === id)),
              ...ql.quests.filter(q => !named.has(q.id)).sort((a, b) => a.order - b.order).map(q => q.id),
            ];
            return {
              ...ql,
              quests: ids.map((id, i) => ({ ...ql.quests.find(q => q.id === id)!, order: i + 1 })),
            };
          }),
        })),

      // ── Routines ──────────────────────────────────────────────────────────

      addRoutine: (title, desc, recurring, questlineId, intervalDays, questId, dueDate, counter, monthlyRule) =>
        set(s => ({ routines: [...s.routines, { id: `r-${uid()}`, title, description: desc, recurring, completed: false, trackedToday: autoPins({ recurring, intervalDays, monthlyRule }), lastResetAt: new Date().toISOString(), streak: 0, order: s.routines.length, ...(questlineId ? { questlineId } : {}), ...(questId ? { questId } : {}), ...(intervalDays ? { intervalDays } : {}), ...(monthlyRule ? { monthlyRule } : {}), ...(!recurring && !monthlyRule && dueDate ? { dueDate } : {}), ...counterFields(counter) }] })),

      setRoutineDueDate: (rId, dueDate) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, dueDate: dueDate ?? null })) })),

      addAnchorRoutine: (title, recurring, counter) =>
        set(s => ({ routines: [...s.routines, { id: `r-${uid()}`, title, description: '', recurring, anchor: true, completed: false, trackedToday: recurring === 'daily', lastResetAt: new Date().toISOString(), streak: 0, order: s.routines.length, ...counterFields(counter) }] })),

      setRoutineRecurring: (rId, recurring, intervalDays, monthlyRule) =>
        set(s => ({ routines: mapById(s.routines, rId, r => {
          const next = { recurring, intervalDays: intervalDays || undefined, monthlyRule: monthlyRule ?? null };
          if (!scheduleChanged(r, next)) return r;
          return {
            ...r, ...next,
            trackedToday: autoPins(next) ? true : r.trackedToday,
            lastResetAt: new Date().toISOString(),
            streak: r.streak ?? 0,
          };
        }) })),

      reorderTodo: (orderedIds) =>
        set(s => {
          const todoOrder = { ...s.todoOrder };
          orderedIds.forEach((id, i) => { todoOrder[id] = i; });
          return { todoOrder };
        }),

      deleteRoutine: (rId) =>
        set(s => ({ routines: s.routines.filter(r => r.id !== rId) })),

      setRoutineQuest: (rId, questId) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, questId: questId ?? undefined })) })),

      addRoutineSubtask: (rId, title, parentSubId) =>
        set(s => mutateRoutine(s, rId, r => ({
          ...r,
          // An open step re-opens the task (roll-up works both ways).
          completed: false,
          completedAt: undefined,
          subtasks: insertNode(r.subtasks ?? [], parentSubId ?? null, { id: `s-${uid()}`, title, completed: false }),
        }))),

      toggleRoutineSubtask: (rId, sId) =>
        set(s => mutateRoutine(s, rId, r => {
          const before = flattenSubtasks(r.subtasks).find(st => st.id === sId);
          const checking = !before?.completed;
          const now = new Date().toISOString();
          // Checking a parent step checks its whole branch; unchecking likewise.
          const subtasks = mapNode(r.subtasks ?? [], sId, st => setSubtreeCompleted(st, checking, now));
          // Roll-up: the task completes exactly when its whole tree is done, and
          // re-opens the moment any step is unchecked.
          const all = flattenSubtasks(subtasks);
          const allDone = all.length > 0 && all.every(st => st.completed);
          return {
            ...r,
            subtasks,
            completed: allDone,
            completedAt: allDone ? (r.completedAt ?? now) : undefined,
            progress: r.target != null && allDone ? r.target : r.progress,
            // Progress on a step un-skips the day — you evidently could do it after all.
            skippedOn: checking ? undefined : r.skippedOn,
          };
        })),

      renameRoutineSubtask: (rId, sId, title) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, subtasks: mapNode(r.subtasks ?? [], sId, st => ({ ...st, title })) })) })),

      deleteRoutineSubtask: (rId, sId) =>
        set(s => mutateRoutine(s, rId, r => {
          const subtasks = removeNode(r.subtasks ?? [], sId);
          const all = flattenSubtasks(subtasks);
          const now = new Date().toISOString();
          // Deleting the last open step can complete the task; deleting every step
          // hands the decision back to the task's own checkbox.
          const completed = all.length > 0 ? all.every(st => st.completed) : r.completed;
          return { ...r, subtasks, completed, completedAt: completed ? (r.completedAt ?? now) : undefined };
        })),

      updateRoutine: (rId, u) =>
        set(s => ({
          routines: mapById(s.routines, rId, r => {
            const next: Routine = { ...r };
            if (u.title !== undefined && u.title.trim())  next.title = u.title.trim();
            if (u.description !== undefined)             next.description = u.description;
            if (u.anchor !== undefined)                  next.anchor = u.anchor || undefined;
            if (u.questlineId !== undefined) {
              next.questlineId = u.questlineId ?? undefined;
              if (!u.questlineId) next.questId = undefined;
              if (u.questlineId) next.anchor = undefined;
            }
            if (u.questId !== undefined)                 next.questId = u.questId ?? undefined;
            if (u.dueDate !== undefined)                 next.dueDate = u.dueDate;
            // Counter: null removes it, a config (re)applies it. Existing progress is
            // clamped to the new target rather than wiped.
            if (u.counter !== undefined) {
              if (u.counter === null) {
                next.target = undefined; next.progress = undefined; next.step = undefined; next.unit = undefined;
              } else if (u.counter.target > 0) {
                next.target   = Math.floor(u.counter.target);
                next.step     = u.counter.step && u.counter.step > 1 ? Math.floor(u.counter.step) : undefined;
                next.unit     = u.counter.unit?.trim() || undefined;
                next.progress = Math.min(next.target, r.progress ?? 0);
              }
            }
            // Cadence: same reset semantics as setRoutineRecurring — a real change
            // restarts the clock and keeps the streak; re-saving the same value is a no-op.
            if (u.recurring !== undefined || u.monthlyRule !== undefined) {
              const sched = {
                recurring: u.recurring !== undefined ? u.recurring : (r.recurring ?? null),
                intervalDays: u.intervalDays || undefined,
                monthlyRule: u.monthlyRule !== undefined ? (u.monthlyRule ?? null) : (r.monthlyRule ?? null),
              };
              if (scheduleChanged(r, sched)) {
                Object.assign(next, sched);
                next.trackedToday = autoPins(sched) ? true : r.trackedToday;
                next.lastResetAt  = new Date().toISOString();
                next.streak       = r.streak ?? 0;
                if (sched.recurring || sched.monthlyRule) next.dueDate = null;
              }
            }
            return next;
          }),
        })),

      toggleRoutine: (rId) =>
        set(s => mutateRoutine(s, rId, r => {
          const completed = !r.completed;
          const now = new Date().toISOString();
          return {
            ...r,
            completed,
            // Counter tasks: checking fills the bar to target, unchecking empties it.
            progress: r.target != null ? (completed ? r.target : 0) : r.progress,
            completedAt: completed ? now : undefined,
            // Unchecking also withdraws today's session mark, so the row doesn't keep
            // reading "done for today" over an empty bar.
            lastProgressAt: completed ? r.lastProgressAt : undefined,
            // Completing a task with a checklist completes the checklist, and vice versa.
            subtasks: r.subtasks?.map(st => setSubtreeCompleted(st, completed, now)),
            // Acting on a task un-skips it — you evidently could do it after all.
            skippedOn: undefined,
          };
        })),

      skipRoutine: (rId) =>
        set(s => {
          const r0 = s.routines.find(r => r.id === rId);
          if (!r0) return {};
          // A lapsed skip is no skip at all: the row renders unskipped, so the click has to
          // mean "skip", not "un-skip".
          const skipping = !skipActive(r0);
          return mutateRoutine(s, rId, r => {
            if (!skipping) return { ...r, skippedOn: undefined };
            // Skip excuses *today only*. A multi-day goal keeps its cycle progress —
            // skipping Tuesday must not erase Monday's gym session — while a daily or
            // one-off task (whose whole cycle is the day) empties out.
            if (isMultiDayCycle(r)) {
              return { ...r, skippedOn: logicalDateKey(), skippedInCycle: true };
            }
            return {
              ...r,
              skippedOn: logicalDateKey(),
              completed: false,
              completedAt: undefined,
              progress: r.target != null ? 0 : r.progress,
              lastProgressAt: undefined,
            };
          });
        }),

      incrementRoutine: (rId, delta) =>
        set(s => {
          const r0 = s.routines.find(r => r.id === rId);
          if (!r0 || r0.target == null) return {};
          return mutateRoutine(s, rId, r => {
            const target = r.target!;
            const next = Math.max(0, Math.min(target, (r.progress ?? 0) + delta));
            const nowComplete = next >= target;
            const now = new Date().toISOString();
            const hadSessionToday = !!r.lastProgressAt && logicalDateKey(new Date(r.lastProgressAt)) === logicalDateKey();
            return {
              ...r,
              progress: next,
              completed: nowComplete,
              completedAt: nowComplete ? (r.completedAt ?? now) : undefined,
              // ＋ marks today's session; − takes today's session back.
              lastProgressAt: delta > 0 ? now : hadSessionToday ? undefined : r.lastProgressAt,
              skippedOn: delta > 0 ? undefined : r.skippedOn,   // making progress un-skips the day
            };
          });
        }),

      toggleRoutineTracked: (rId) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, trackedToday: !r.trackedToday })) })),

      toggleRoutineHidden: (rId) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, hidden: !r.hidden })) })),

      updateRoutineTitle: (rId, title) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, title })) })),

      updateActionTitle: (qlId, qId, aId, title) =>
        set(s => ({ questlines: mapAction(s.questlines, qlId, qId, aId, a => ({ ...a, title })) })),

      // Also stamps/clears completedAt so Today's linger rule and the All tab's
      // archive clock stay truthful no matter which path completed the task.
      setRoutineCompleted: (rId, completed) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, completed, completedAt: completed ? (r.completedAt ?? new Date().toISOString()) : undefined })) })),

      setAllActionsComplete: (qlId, qId, complete) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, actions: q.actions.map(a => ({ ...a, completed: complete })) })) })),
    }),
    { name: QUEST_STORE_KEY }
  )
);

// ── UI state ──────────────────────────────────────────────────────────────────
interface UIStore {
  editMode: boolean;
  theme: 'dark' | 'light';
  toggleEditMode: () => void;
  toggleTheme: () => void;
}
export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      editMode: false,
      theme: 'dark' as 'dark' | 'light',
      toggleEditMode: () => set(s => ({ editMode: !s.editMode })),
      toggleTheme: () => set(s => {
        const next = s.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        return { theme: next };
      }),
    }),
    { name: UI_STORE_KEY }
  )
);
