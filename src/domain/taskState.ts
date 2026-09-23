import { type Questline, type Quest, type Action, type Routine, type Subtask, type System } from '../types';
import { flattenTree, mapTree } from '../lib/subtree';
import { ANCHOR_LABEL } from '../lib/ui';
import {
  logicalDayStart, periodExpired, skipActive, isMultiDayCycle, sessionMode, sessionOn, dateKey,
  logicalDateKey,
} from './schedule';

/** Counter configuration shared by task creation and normalization. */
export interface CounterConfig { target: number; step?: number; unit?: string; }

/** Every node of a (possibly nested) subtask tree, flattened. */
export const flattenSubtasks = (list: Subtask[] | undefined): Subtask[] => flattenTree(list);

/** Done/total across the whole subtask tree. */
export function subtaskStats(list: Subtask[] | undefined): { done: number; total: number } {
  const all = flattenSubtasks(list);
  return { done: all.filter(st => st.completed).length, total: all.length };
}

/** Set completion on a node and everything under it (checking a parent checks the branch). */
export function setSubtreeCompleted(st: Subtask, completed: boolean, now: string): Subtask {
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
  // A session-mode task keeps an explicit record of which days it happened on.
  // That record is the answer — inferring it from the last tap's timestamp would
  // get a backfilled day wrong in both directions.
  if (sessionMode(r)) return sessionOn(r, dayKey);
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
  // A session-mode goal earns credit on exactly the days it happened — not on
  // every day once it completes, which is what would let a backfilled Tuesday
  // move today's square.
  if (sessionMode(r)) return sessionOn(r, dayKey) ? 1 : 0;
  if (isMultiDayCycle(r)) return r.completed || engagedOnDay(r, dayKey) ? 1 : 0;
  return r.completed ? 1 : 0;
}

function clearActions(actions: Action[]): Action[] {
  // completedAt goes with `completed`: a new cycle has earned nothing yet, and a
  // stale stamp would aim the next un-check at the previous cycle's day.
  return actions.map(a => ({ ...a, completed: false, completedAt: undefined, trackedToday: false }));
}

/** Normalise a CounterConfig into the routine fields it sets (or nothing). */
export function counterFields(counter?: CounterConfig): Partial<Routine> {
  if (!counter || !(counter.target > 0)) return {};
  return {
    target: Math.floor(counter.target),
    progress: 0,
    ...(counter.step && counter.step > 1 ? { step: Math.floor(counter.step) } : {}),
    ...(counter.unit?.trim() ? { unit: counter.unit.trim() } : {}),
  };
}

export function processQuestlines(questlines: Questline[]): Questline[] {
  const now = new Date().toISOString();
  return questlines.map(ql => {
    // Questline-level reset
    if (ql.recurring && periodExpired(ql)) {
      const { done, total } = questlineProgress(ql);
      return {
        ...ql, lastResetAt: now,
        streak: (done === total && total > 0) ? (ql.streak ?? 0) + 1 : 0,
        quests: ql.quests.map(q => ({ ...q, actions: clearActions(q.actions), completed: false, completedAt: undefined, lastResetAt: now })),
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
            return { ...quest, actions: clearActions(quest.actions), completed: false, completedAt: undefined, lastResetAt: now, streak: wasComplete ? (quest.streak ?? 0) + 1 : 0 };
          }
          return quest;
        }
        return {
          ...quest,
          actions: quest.actions.map(a => {
            if (!a.recurring && !a.intervalDays && !a.monthlyRule) return a;
            if (!a.lastResetAt) return { ...a, lastResetAt: now };
            if (periodExpired(a)) return { ...a, completed: false, completedAt: undefined, trackedToday: a.recurring === 'daily', lastResetAt: now };
            return a;
          }),
        };
      }),
    };
  });
}

export function processRoutines(routines: Routine[]): Routine[] {
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
        // Sessions are scoped to the cycle that just ended — the new week starts
        // with an empty strip. The days themselves survive in taskHistory.
        sessionDays: undefined,
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

/**
 * Move a day's heatmap credit.
 *
 * `dayKey` matters: crediting is always "today", but *un*-crediting has to name
 * the day the work was actually completed. Unchecking on Tuesday something you
 * finished on Monday used to decrement Tuesday — Monday kept credit for work
 * that no longer existed, and Tuesday silently lost a square it never earned
 * (clamped at zero, so it just disappeared). Routines never had this bug because
 * they go through `mutateRoutine`'s day-credit diffing; the quest paths did.
 */
export function bumpLog(log: Record<string, number>, delta: number, dayKey: string = logicalDateKey()): Record<string, number> {
  const next = Math.max(0, (log[dayKey] ?? 0) + delta);
  return { ...log, [dayKey]: next };
}

/** The logical day an item's completion belongs to, falling back to today when
 *  the item predates completion stamps. */
export const completedDay = (completedAt?: string): string =>
  completedAt ? logicalDateKey(new Date(completedAt)) : logicalDateKey();

// ── Per-task history ─────────────────────────────────────────────────────────
//
// `completionLog` counts tasks per day. It can say "you finished three things on
// Tuesday" but never *which* three, so it cannot answer the question that
// actually matters — which habit have I been quietly failing for a month? Streaks
// only carry a current value, so they can't answer it either.
//
// This records the logical days each task earned credit on. It is not
// reconstructible after the fact: nothing already stored says which task a past
// day's count belonged to, so the history only ever starts from now.

/** Task id → the logical day keys ('YYYY-MM-DD') it was completed on, ascending. */
export type TaskHistory = Record<string, string[]>;

/** How far back per-task history is kept. Comfortably longer than any view of
 *  it, and bounded so a years-old install doesn't carry an ever-growing map. */
export const HISTORY_RETENTION_DAYS = 400;

/** How long a deleted task's history outlives the task. Not zero: undo can bring
 *  a task back seconds later, and its history should come back with it. */
const ORPHAN_RETENTION_DAYS = 30;

/** Record (or withdraw) one task's credit for one logical day. Idempotent in both
 *  directions — the callers diff day-credit, and a no-op must not clone the map. */
export function markHistory(h: TaskHistory, id: string, dayKey: string, on: boolean): TaskHistory {
  const days = h[id] ?? [];
  if (on === days.includes(dayKey)) return h;
  if (!on) {
    const next = days.filter(d => d !== dayKey);
    if (next.length) return { ...h, [id]: next };
    // Last day gone: drop the key entirely rather than leaving an empty array,
    // so "has this task ever been done" stays a simple presence check.
    const rest = { ...h };
    delete rest[id];
    return rest;
  }
  return { ...h, [id]: [...days, dayKey].sort() };
}

/** Days a task has been completed on, newest last. */
export const historyOf = (h: TaskHistory | undefined, id: string): string[] => h?.[id] ?? [];

/**
 * Keep the full history of every saved task, including hidden and archived
 * records. Only entries for explicitly deleted tasks eventually age out.
 *
 * The orphan grace period is what keeps undo whole — a task deleted a moment ago
 * still has recent days, so its history survives until long after the undo offer
 * has expired.
 */
export function pruneHistory(h: TaskHistory, liveIds: Set<string>): TaskHistory {
  const dayFloor = dateKey(new Date(logicalDayStart().getTime() - HISTORY_RETENTION_DAYS * 86_400_000));
  const orphanFloor = dateKey(new Date(logicalDayStart().getTime() - ORPHAN_RETENTION_DAYS * 86_400_000));
  let changed = false;
  const out: TaskHistory = {};
  for (const [id, days] of Object.entries(h)) {
    if (liveIds.has(id)) { out[id] = days; continue; }
    const kept = days.filter(d => d >= dayFloor);
    // An orphan is only dropped once even its newest day has aged out.
    if (!kept.length || (!liveIds.has(id) && kept[kept.length - 1] < orphanFloor)) { changed = true; continue; }
    if (kept.length !== days.length) changed = true;
    out[id] = kept;
  }
  return changed ? out : h;
}

/** Every id per-task history can legitimately be keyed by, for orphan pruning. */
export function liveTaskIds(questlines: Questline[], routines: Routine[]): Set<string> {
  const ids = new Set<string>(routines.map(r => r.id));
  for (const ql of questlines) {
    for (const q of ql.quests) {
      ids.add(q.id);
      for (const a of q.actions) ids.add(a.id);
    }
  }
  return ids;
}

/** Apply `mutate` to one routine and settle its heatmap credit for today: the
 *  completion log moves by the *difference* in dayCredit, so every path into a
 *  routine (checkbox, counter tap, subtask, skip) counts a day at most once.
 *  Per-task history rides the same diff, so the two can never disagree. */
function mutateRoutineOnDay(
  s: { routines: Routine[]; completionLog: Record<string, number>; taskHistory?: TaskHistory },
  rId: string,
  dayKey: string,
  mutate: (r: Routine) => Routine,
): Partial<{ routines: Routine[]; completionLog: Record<string, number>; taskHistory: TaskHistory }> {
  const r0 = s.routines.find(r => r.id === rId);
  if (!r0) return {};
  const r1 = mutate(r0);
  const diff = dayCredit(r1, dayKey) - dayCredit(r0, dayKey);
  return {
    routines: s.routines.map(r => (r.id === rId ? r1 : r)),
    completionLog: diff === 0 ? s.completionLog : bumpLog(s.completionLog, diff, dayKey),
    taskHistory: diff === 0 ? (s.taskHistory ?? {}) : markHistory(s.taskHistory ?? {}, rId, dayKey, diff > 0),
  };
}

/** The common case: settle today. Backfilling an earlier day goes through
 *  `mutateRoutineOnDay` directly, so its credit lands on the day it belongs to. */
export const mutateRoutine = (
  s: { routines: Routine[]; completionLog: Record<string, number>; taskHistory?: TaskHistory },
  rId: string,
  mutate: (r: Routine) => Routine,
) => mutateRoutineOnDay(s, rId, logicalDateKey(), mutate);

/**
 * Log (or un-log) one day of a session-mode goal.
 *
 * A pure patch rather than an action of its own, because two entry points need
 * exactly these semantics — the strip under the row, and the counter's ＋/− —
 * and a second copy is a second thing to get subtly different.
 *
 * The whole point of the mode is here: a day is either done or it isn't, so
 * tapping the same day twice can never advance the goal. Credit settles on
 * `dayKey`, so backfilling the Tuesday you forgot puts the square on Tuesday.
 */
export function sessionPatch(
  s: { routines: Routine[]; completionLog: Record<string, number>; taskHistory?: TaskHistory },
  rId: string,
  dayKey: string,
) {
  const r0 = s.routines.find(r => r.id === rId);
  if (!r0 || !sessionMode(r0)) return {};
  // A day that hasn't happened yet isn't a session you can have done.
  if (dayKey > logicalDateKey()) return {};

  const today = logicalDateKey();
  return mutateRoutineOnDay(s, rId, dayKey, r => {
    const wasOn = sessionOn(r, dayKey);
    const days = wasOn
      ? (r.sessionDays ?? []).filter(d => d !== dayKey)
      : [...(r.sessionDays ?? []), dayKey].sort();
    // A fourth visit in a 3× week is allowed and shows on the strip; progress
    // just doesn't run past the goal.
    const progress = Math.min(r.target!, days.length);
    const complete = progress >= r.target!;
    const now = new Date().toISOString();
    const touchedToday = dayKey === today;
    return {
      ...r,
      sessionDays: days.length ? days : undefined,
      progress,
      completed: complete,
      completedAt: complete ? (r.completedAt ?? now) : undefined,
      lastProgressAt: touchedToday ? (wasOn ? undefined : now) : r.lastProgressAt,
      // Logging today's session un-skips the day — you evidently did it after all.
      skippedOn: touchedToday && !wasOn ? undefined : r.skippedOn,
    };
  });
}

// ── One-time task archive ─────────────────────────────────────────────────────

/** A completed one-time General task is "archived": it stays in its group (checked,
 *  at the bottom) through the day it was completed, then moves to the All tab's
 *  Archived section the next logical day. Archived records are retained until
 *  the user explicitly deletes them. */
export function isArchivedRoutine(r: Routine, todayKey: string = logicalDateKey()): boolean {
  if (r.recurring || r.intervalDays || r.monthlyRule) return false;
  if (r.questlineId || r.anchor) return false;
  if (!r.completed || !r.completedAt) return false;
  return logicalDateKey(new Date(r.completedAt)) < todayKey;
}

// ── Systems ──────────────────────────────────────────────────────────────────

/**
 * One-time migration: the anchor group stops being a system.
 *
 * It was seeded as one when systems landed, on the reasoning that it already
 * *was* a system in everything but name. It isn't. A system is a process aimed
 * at a goal; this group is the handful of things you want in front of you every
 * day whatever else is going on, which is a place on the Today tab rather than a
 * process with a consistency score.
 *
 * So the system is deleted and its members marked `anchor`, which is what puts
 * them in that section. Nothing is lost: the habits, their streaks and their
 * history are untouched, and any *other* system they belong to is left alone.
 * Gated on a flag so it can't undo a system you deliberately rebuilt by hand.
 */
export function retireAnchorSystem(
  routines: Routine[],
  systems: System[],
  retired: boolean | undefined,
): { routines: Routine[]; systems: System[] } {
  if (retired) return { routines, systems };
  const anchorSystem = systems.find(sys => sys.title === ANCHOR_LABEL);
  if (!anchorSystem) return { routines, systems };

  // The grouping survives as the Today section; only the system goes. Every
  // member is marked so it lands in that section rather than being scattered
  // into the day's main list.
  const members = new Set(routines.filter(r => routineSystemIds(r).includes(anchorSystem.id)).map(r => r.id));
  return {
    systems: systems.filter(sys => sys.id !== anchorSystem.id),
    routines: routines.map(r => {
      if (!members.has(r.id)) return r;
      const rest = routineSystemIds(r).filter(id => id !== anchorSystem.id);
      return { ...withSystems(r, rest), anchor: true };
    }),
  };
}

/** The goals a system serves, reading the legacy single field when the array
 *  isn't there yet. The one place either field should be read. */
export const systemGoalIds = (sys: System): string[] =>
  sys.questlineIds ?? (sys.questlineId ? [sys.questlineId] : []);

/** The quests a system contributes to. Separate from `systemGoalIds`: that is
 *  the questline it serves broadly, this is the goal inside it. */
export const systemQuestIds = (sys: System): string[] => sys.questIds ?? [];

/** The systems a habit is part of, reading the legacy single field when the
 *  array isn't there yet. The one place either field should be read. */
export const routineSystemIds = (r: Routine): string[] =>
  r.systemIds ?? (r.systemId ? [r.systemId] : []);

/**
 * A General task — the Quests page's "things to accomplish" bucket. No
 * questline, no system, not an anchor habit.
 *
 * One definition, because two places have to agree on it: the panel that lists
 * them, and `showsOnDay`, which keeps the one-off ones off Today until they are
 * pinned there.
 */
export const isGeneralTask = (r: Routine): boolean =>
  !r.questlineId && !r.anchor && routineSystemIds(r).length === 0;

/** Write a habit's system membership, retiring the legacy single field with it.
 *  Both are set together so the two can never disagree. */
export const withSystems = (r: Routine, ids: string[]): Routine =>
  ({ ...r, systemIds: ids, systemId: undefined });

/** The editable face of a System, shared by create and update.
 *  A system is its name, its actions, and the goal it serves — the actions live
 *  on the routines themselves, so this is the rest. */
export interface SystemFields {
  spaceId?: string;
  description?: string;
  icon?: string;
  /** The goals this system serves. An empty array detaches them all — a system
   *  is allowed to serve none. */
  questlineIds?: string[];
  /** The individual quests it contributes to. Same rules. */
  questIds?: string[];
}


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
  if (quest.completionMode === 'manual') return !!quest.completed;
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
