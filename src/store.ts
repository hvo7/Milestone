import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Questline, Quest, Action, GuildColor, RecurringType, Routine, Schedule, MonthlyRule, System,
} from './types';
import { sampleData } from './data/sampleData';
import { mapNode, insertNode, removeNode } from './lib/subtree';
import { pushUndo, insertAt, reinsert, captureRemoved, deleteLabel } from './lib/undo';
import { sameTitle } from './lib/duplicates';

import { QUEST_STORE_KEY } from './uiStore';
export { QUEST_STORE_KEY, UI_STORE_KEY } from './uiStore';
export { useUIStore, DEFAULT_REMINDERS, type ReminderSettings } from './uiStore';
export {
  isQuestUnlocked, isQuestComplete, isCycleComplete, isRoutineComplete, getActiveQuest,
  questlineProgress, questProgress,
} from './domain/taskState';
import {
  skipActive, repeats, sameRule, isMultiDayCycle, onToday, actionOnToday, sessionMode, sessionOn, logicalDateKey,
} from './domain/schedule';
export {
  recurrenceLabel, getResetDisplay, type DueDateInfo, getDueDateInfo, DAY_RESET_HOUR,
  logicalDayStart, periodExpired, dueOnDay, skipActive, repeats, sameRule, isMultiDayCycle,
  type FixedReason, alwaysOnToday, onToday, isGoalRoutine, sessionMode, sessionOn, MAX_STRIP_DAYS,
  cycleDayKeys, dayInitial, dateKey, logicalDateKey,
} from './domain/schedule';
import {
  type CounterConfig, flattenSubtasks, setSubtreeCompleted, counterFields, processQuestlines,
  processRoutines, bumpLog, completedDay, type TaskHistory, markHistory, historyOf, pruneHistory,
  liveTaskIds, mutateRoutine, sessionPatch, retireAnchorSystem, systemGoalIds,
  systemQuestIds, routineSystemIds, withSystems, isQuestComplete, type SystemFields,
} from './domain/taskState';
export {
  type CounterConfig, flattenSubtasks, subtaskStats, engagedOnDay, type TaskHistory,
  HISTORY_RETENTION_DAYS, historyOf, isArchivedRoutine, systemGoalIds,
  systemQuestIds, routineSystemIds, isGeneralTask, type SystemFields,
} from './domain/taskState';

function uid() { return Math.random().toString(36).slice(2, 10); }


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

// ── Store ─────────────────────────────────────────────────────────────────────

export const DEFAULT_SPACES: import("./types").Space[] = [{ id: "vynues", name: "Vynues" }];

interface QuestData {
  spaces?: import("./types").Space[];
  questlines: Questline[];
  routines: Routine[];
  /** The processes you're running, as opposed to the outcomes you're chasing.
   *  See the System type — the separation from Questline is the point. */
  systems: System[];
  /** @deprecated Marked the old anchor-habits→first-system seed. That seed is
   *  gone; the flag is left declared so an existing save that carries it still
   *  type-checks. */
  systemsSeeded?: boolean;
  /** True once the anchor system has been turned back into a Today section. A
   *  flag rather than a title check, so rebuilding a system by that name later
   *  doesn't get it deleted again. */
  anchorSystemRetired?: boolean;
  /** Tasks completed per local day, keyed 'YYYY-MM-DD'. Drives the heatmap. */
  completionLog: Record<string, number>;
  /** Which days each individual task was completed on — the per-task detail the
   *  aggregate log above throws away. Optional: saves written before it existed
   *  simply have none, and it starts filling from the first completion after
   *  upgrading. See TaskHistory. */
  taskHistory: TaskHistory;
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
  addSpace: (name: string) => string | null;
  updateSpace: (id: string, updates: { name?: string; archived?: boolean }) => void;
  addQuestline:       (title: string, desc: string, icon: string, color: GuildColor, spaceId?: string) => void;
  updateQuestline:    (qlId: string, updates: Partial<Pick<Questline,'title'|'description'|'icon'|'color'|'sequential'|'recurring'|'targetDate'|'spaceId'>>) => void;
  addQuest:           (qlId: string, title: string, desc: string, recurring: RecurringType | null, dueDate: string | null, monthlyRule?: MonthlyRule | null, completionMode?: Quest['completionMode']) => void;
  updateQuestTitle:   (qlId: string, qId: string, title: string) => void;
  updateQuest:        (qlId: string, qId: string, updates: Partial<Pick<Quest,'title'|'description'|'recurring'|'dueDate'|'intervalDays'|'monthlyRule'|'completionMode'>>) => void;
  moveQuest:          (fromQlId: string, toQlId: string, qId: string) => void;
  deleteQuestline:    (qlId: string) => void;
  deleteQuest:        (qlId: string, qId: string) => void;
  reorderQuestlines:  (orderedIds: string[]) => void;
  reorderQuests:      (qlId: string, orderedIds: string[]) => void;

  // Routines
  /** Returns the new task's id, so the caller can file it into a system too. */
  addRoutine:           (title: string, desc: string, recurring: RecurringType | null, questlineId?: string, intervalDays?: number, questId?: string, dueDate?: string | null, counter?: CounterConfig, monthlyRule?: MonthlyRule | null) => string;
  /** Set/clear a one-time task's due date ('YYYY-MM-DD' or null). */
  setRoutineDueDate:    (rId: string, dueDate: string | null) => void;
  /** Add a habit to the highlighted anchor-habit category (Today tab). */
  addAnchorRoutine:     (title: string, recurring: 'daily' | 'weekly', counter?: CounterConfig) => string;
  /** Nudge a counter task's progress by `delta` (clamped to 0…target); auto-completes at target.
   *  On a session-mode goal this means "I did it today" / "I didn't" — see sessionPatch. */
  incrementRoutine:     (rId: string, delta: number) => void;
  /** Log (or un-log) one logical day of a session-mode goal — "went to the gym on
   *  Tuesday". Refuses days in the future, and credits the day itself rather than
   *  today, so a backfill lands where it belongs. */
  toggleSession:        (rId: string, dayKey: string) => void;
  /** Set a counter straight to a value — the checkpoint pips under the row, where
   *  tapping the third of four means 48/64 rather than three separate nudges. */
  setRoutineProgress:   (rId: string, value: number) => void;
  /** Toggle "skipped today" on a recurring task — a neutral day that earns no heatmap
   *  credit but preserves the streak (e.g. a walk on a rainy day). It returns next period. */
  skipRoutine:          (rId: string) => void;
  /** Change a routine's cadence (null = one-time) and optional custom interval in days. */
  setRoutineRecurring:  (rId: string, recurring: RecurringType | null, intervalDays?: number, monthlyRule?: MonthlyRule | null) => void;
  deleteRoutine:        (rId: string) => void;
  /** Fold one task into another: the survivor takes the union of their systems,
   *  their history and their steps, and the better streak. For the same habit
   *  entered twice — see lib/duplicates.ts. */
  mergeRoutines:        (keepId: string, dropId: string) => void;
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
    /** Count days rather than taps. `null` hands the choice back to the default
     *  derived from the task's shape — see sessionMode. */
    oncePerDay?: boolean | null;
    /** Set the streak by hand. The counter is a record of your practice, not a
     *  score to be defended: the app misses days you didn't (a laptop left shut,
     *  a task added late), and only you know which. Clamped to a whole number
     *  ≥ 0; everything downstream keeps working from there. */
    streak?: number;
  }) => void;
  /** Fill an empty app with the demo questlines. Opt-in from the first-run card
   *  — a fresh install starts genuinely empty rather than pretending three
   *  fabricated goals are yours. Refuses once there is anything to lose. */
  loadSampleData:       () => void;
  toggleRoutine:        (rId: string) => void;
  toggleRoutineTracked: (rId: string) => void;
  toggleRoutineHidden:  (rId: string) => void;
  updateRoutineTitle:      (rId: string, title: string) => void;
  updateActionTitle:       (qlId: string, qId: string, aId: string, title: string) => void;
  setRoutineCompleted:     (rId: string, completed: boolean) => void;
  setAllActionsComplete:   (qlId: string, qId: string, complete: boolean) => void;

  // ── Systems ────────────────────────────────────────────────────────────────
  /** Create a system. Returns its id so a caller can drop straight into it. */
  addSystem:    (title: string, opts?: SystemFields) => string;
  updateSystem: (sId: string, updates: SystemFields & { title?: string; hidden?: boolean }) => void;
  /** Delete a system. Its habits survive, unassigned: the practice is the part
   *  worth keeping, and deleting a grouping should never delete the work. */
  deleteSystem: (sId: string) => void;
  /** Replace a habit's system membership outright. An empty array takes it out
   *  of every system. */
  setRoutineSystems: (rId: string, ids: string[]) => void;
  /** Add or remove one membership, leaving the habit's others alone — a habit can
   *  be part of several processes at once. */
  toggleRoutineSystem: (rId: string, sysId: string) => void;
  /** Create a repeating action directly inside a system. The system panel builds
   *  its actions here rather than through addRoutine, which has no idea systems
   *  exist and would leave the new task orphaned. */
  addSystemAction: (systemId: string, title: string, recurring: RecurringType | null, intervalDays?: number) => void;
}

export const useQuestStore = create<QuestData>()(
  persist(
    (set) => ({
      // A new install starts empty. Seeding the demo questlines used to make a
      // first launch look like someone else's half-finished goals, and on the
      // public web build that is the first thing a stranger sees. The Today and
      // Quests pages offer to load them instead — see loadSampleData.
      spaces: DEFAULT_SPACES,
      addSpace: (name) => {
        const title = name.trim();
        if (!title) return null;
        const id = `space-${uid()}`;
        let added = false;
        set(s => {
          const spaces = s.spaces ?? DEFAULT_SPACES;
          if (spaces.some(x => x.name.toLocaleLowerCase() === title.toLocaleLowerCase())) return {};
          added = true;
          return { spaces: [...spaces, { id, name: title }] };
        });
        return added ? id : null;
      },
      updateSpace: (id, updates) => set(s => {
        const spaces = s.spaces ?? DEFAULT_SPACES;
        const name = updates.name?.trim();
        if (updates.name !== undefined && (!name || spaces.some(x => x.id !== id && x.name.toLocaleLowerCase() === name.toLocaleLowerCase()))) return {};
        return { spaces: spaces.map(x => x.id === id ? { ...x, ...updates, ...(name ? { name } : {}) } : x) };
      }),
      questlines: [],
      routines: [],
      systems: [],
      completionLog: {},
      taskHistory: {},
      todoOrder: {},

      loadSampleData: () =>
        set(s => (s.questlines.length || s.routines.length ? {} : { questlines: sampleData })),

      checkAndResetRecurring: () =>
        set(s => {
          const questlines = processQuestlines(s.questlines);
          const processed = processRoutines(s.routines);
          const moved = retireAnchorSystem(processed, s.systems ?? [], s.anchorSystemRetired);
          return {
            questlines,
            routines: moved.routines,
            systems: moved.systems,
            anchorSystemRetired: true,
            // Archived tasks remain live records and retain their history.
            taskHistory: pruneHistory(s.taskHistory ?? {}, liveTaskIds(questlines, moved.routines)),
          };
        }),

      toggleAction: (qlId, qId, aId) =>
        set(s => {
          const before = findQuest(s.questlines, qlId, qId)?.actions.find(a => a.id === aId);
          if (!before) return {};
          const now = new Date().toISOString();
          const checking = !before.completed;
          // The same day both the log and the history move on, so the two can
          // never drift: today when crediting, the completion's own day when not.
          const day = checking ? logicalDateKey() : completedDay(before.completedAt);
          return {
            questlines: mapAction(s.questlines, qlId, qId, aId, a => ({
              ...a,
              completed: checking,
              completedAt: checking ? now : undefined,
            })),
            // Un-crediting targets the day the action was actually completed.
            completionLog: bumpLog(s.completionLog, checking ? 1 : -1, day),
            taskHistory: markHistory(s.taskHistory ?? {}, aId, day, checking),
          };
        }),

      toggleTracked: (qlId, qId, aId) =>
        set(s => ({ questlines: mapAction(s.questlines, qlId, qId, aId, a => ({ ...a, trackedToday: !actionOnToday(a), offToday: actionOnToday(a) ? true : undefined })) })),

      toggleQuestTracked: (qlId, qId) =>
        set(s => ({ questlines: mapQuest(s.questlines, qlId, qId, q => {
          const on = !q.offToday && (!!q.trackedToday || q.dueDate?.slice(0, 10) === logicalDateKey());
          return { ...q, trackedToday: !on, offToday: on ? true : undefined };
        }) })),

      // Checking a quest off Today completes its whole checklist at once (or, for an
      // action-less quest, flips its own flag). The heatmap moves by the number of
      // sub-tasks that actually changed state, so it stays consistent with ticking
      // those actions one by one — a quest of 3 tasks counts as 3, not 1.
      setQuestComplete: (qlId, qId, complete) =>
        set(s => {
          const quest = findQuest(s.questlines, qlId, qId);
          if (!quest) return {};
          const visible = quest.actions.filter(a => !a.hidden);
          const now = new Date().toISOString();
          let log = s.completionLog;
          let history = s.taskHistory ?? {};
          let nextQuest: Quest;

          if (quest.completionMode === 'manual') {
            if (!!quest.completed === complete) return {};
            // Switching an already-complete legacy quest to manual mode creates
            // no new credit. Only undo credit actually earned by achievement.
            if (complete || quest.completedAt) {
              const day = complete ? logicalDateKey() : completedDay(quest.completedAt);
              log = bumpLog(log, complete ? 1 : -1, day);
              history = markHistory(history, qId, day, complete);
            }
            nextQuest = { ...quest, completed: complete, completedAt: complete ? now : undefined };
          } else if (visible.length === 0) {
            if (!!quest.completed === complete) return {};   // no change
            const day = complete ? logicalDateKey() : completedDay(quest.completedAt);
            log = bumpLog(log, complete ? 1 : -1, day);
            history = markHistory(history, qId, day, complete);
            nextQuest = { ...quest, completed: complete, completedAt: complete ? now : undefined };
          } else {
            // Each action carries its own credit day, so the log moves per action
            // rather than by one lump delta against today.
            for (const a of visible) {
              if (complete === a.completed) continue;
              const day = complete ? logicalDateKey() : completedDay(a.completedAt);
              log = bumpLog(log, complete ? 1 : -1, day);
              history = markHistory(history, a.id, day, complete);
            }
            nextQuest = {
              ...quest,
              actions: quest.actions.map(a => a.hidden ? a : {
                ...a,
                completed: complete,
                // Keep an existing stamp: re-completing an already-done action
                // must not move its credit to today.
                completedAt: complete ? (a.completedAt ?? now) : undefined,
              }),
            };
          }
          return {
            questlines: mapQuest(s.questlines, qlId, qId, () => nextQuest),
            completionLog: log,
            taskHistory: history,
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
        set(s => {
          const quest = findQuest(s.questlines, qlId, qId);
          const index = quest?.actions.findIndex(a => a.id === aId) ?? -1;
          if (!quest || index < 0) return {};
          const action = quest.actions[index];
          pushUndo(deleteLabel(action.title), () =>
            set(cur => ({ questlines: mapQuest(cur.questlines, qlId, qId, q => ({ ...q, actions: reinsert(q.actions, [{ index, item: action }]) })) })));
          return { questlines: mapQuest(s.questlines, qlId, qId, q => ({ ...q, actions: q.actions.filter(a => a.id !== aId) })) };
        }),

      toggleQuestlineHidden: (qlId) =>
        set(s => ({ questlines: mapById(s.questlines, qlId, ql => ({ ...ql, hidden: !ql.hidden })) })),

      addQuestline: (title, desc, icon, color, spaceId) =>
        set(s => ({ questlines: [...s.questlines, { id: `ql-${uid()}`, title, description: desc, icon, color, spaceId, quests: [], sequential: false, createdAt: new Date().toISOString() }] })),

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

      addQuest: (qlId, title, desc, recurring, dueDate, monthlyRule, completionMode) =>
        set(s => ({
          questlines: mapById(s.questlines, qlId, ql => {
            const q: Quest = { id: `q-${uid()}`, title, description: desc, order: ql.quests.length + 1, actions: [], completionMode: completionMode ?? (recurring || monthlyRule ? 'steps' : 'manual'), recurring: recurring ?? null, ...(monthlyRule ? { monthlyRule } : {}), lastResetAt: (recurring || monthlyRule) ? new Date().toISOString() : undefined, streak: 0, dueDate: monthlyRule ? null : (dueDate ?? null) };
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
              ...(updates.completionMode === 'manual' && q.completionMode !== 'manual' ? { completed: isQuestComplete(q) } : {}),
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

      // Removing a questline also removes its nested quests/actions (they live inside it)
      // and any standalone routines linked to it, so nothing is orphaned in the Today
      // list. That cascade is the whole reason this is undoable: a single ✕ can take
      // months of streak history with it, and nothing on screen says how much until
      // the toast names it.
      deleteQuestline: (qlId) =>
        set(s => {
          const index = s.questlines.findIndex(ql => ql.id === qlId);
          if (index < 0) return {};
          const questline = s.questlines[index];
          const linked = captureRemoved(s.routines, r => r.questlineId === qlId);
          // Systems that served this goal are detached, never deleted: the
          // process is the part worth keeping when the outcome goes away.
          const served = s.systems.filter(sys => systemGoalIds(sys).includes(qlId)).map(sys => sys.id);
          pushUndo(
            deleteLabel(questline.title, [[questline.quests.length, 'quest'], [linked.length, 'task']]),
            () => set(cur => ({
              questlines: cur.questlines.some(ql => ql.id === qlId) ? cur.questlines : insertAt(cur.questlines, index, questline),
              routines: reinsert(cur.routines, linked),
              systems: cur.systems.map(sys => (served.includes(sys.id)
                ? { ...sys, questlineIds: [...systemGoalIds(sys), qlId], questlineId: undefined }
                : sys)),
            })),
          );
          return {
            questlines: s.questlines.filter(ql => ql.id !== qlId),
            routines: s.routines.filter(r => r.questlineId !== qlId),
            systems: s.systems.map(sys => {
              // Both attachments go: the questline itself, and every quest that
              // lived inside it.
              const goneQuests = new Set((s.questlines.find(ql => ql.id === qlId)?.quests ?? []).map(q => q.id));
              const goals = systemGoalIds(sys).filter(id => id !== qlId);
              const quests = systemQuestIds(sys).filter(id => !goneQuests.has(id));
              if (goals.length === systemGoalIds(sys).length && quests.length === systemQuestIds(sys).length) return sys;
              return { ...sys, questlineIds: goals, questlineId: undefined, questIds: quests };
            }),
          };
        }),

      deleteQuest: (qlId, qId) =>
        set(s => {
          const questline = s.questlines.find(ql => ql.id === qlId);
          const index = questline?.quests.findIndex(q => q.id === qId) ?? -1;
          if (!questline || index < 0) return {};
          const quest = questline.quests[index];
          // Linked tasks are detached rather than deleted, so undo re-attaches
          // exactly the ones that were pointing here — not every task that has
          // since been linked to something else.
          const detached = s.routines.filter(r => r.questId === qId).map(r => r.id);
          pushUndo(
            deleteLabel(quest.title, [[quest.actions.length, 'task']]),
            () => set(cur => ({
              questlines: mapById(cur.questlines, qlId, ql => ({
                ...ql,
                quests: (ql.quests.some(q => q.id === qId) ? ql.quests : insertAt(ql.quests, index, quest))
                  .map((q, i) => ({ ...q, order: i + 1 })),
              })),
              routines: cur.routines.map(r => (detached.includes(r.id) && !r.questId ? { ...r, questId: qId } : r)),
            })),
          );
          return {
            questlines: mapById(s.questlines, qlId, ql => ({ ...ql, quests: ql.quests.filter(q => q.id !== qId).map((q, i) => ({ ...q, order: i + 1 })) })),
            // Detach (but keep) any linked tasks that pointed at the deleted quest.
            routines: s.routines.map(r => r.questId === qId ? { ...r, questId: undefined } : r),
            // Same for the systems that fed it: the goal goes, the process stays.
            systems: s.systems.map(sys => (systemQuestIds(sys).includes(qId)
              ? { ...sys, questIds: systemQuestIds(sys).filter(id => id !== qId) }
              : sys)),
          };
        }),

      reorderQuestlines: orderedIds => set(s => {
        const byId = new Map(s.questlines.map(ql => [ql.id, ql]));
        const ids = [...new Set(orderedIds)].filter(id => byId.has(id));
        const included = new Set(ids);
        let index = 0;
        // A filtered sidebar only moves the rows it shows. Hidden or omitted
        // questlines stay in their slots, with all nested content intact.
        const questlines = s.questlines.map(ql => included.has(ql.id) ? byId.get(ids[index++])! : ql);
        return questlines.every((ql, i) => ql === s.questlines[i]) ? {} : { questlines };
      }),

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

      addRoutine: (title, desc, recurring, questlineId, intervalDays, questId, dueDate, counter, monthlyRule) => {
        const id = `r-${uid()}`;
        set(s => ({ routines: [...s.routines, { id, title, description: desc, recurring, completed: false, trackedToday: autoPins({ recurring, intervalDays, monthlyRule }), lastResetAt: new Date().toISOString(), createdAt: new Date().toISOString(), streak: 0, order: s.routines.length, ...(questlineId ? { questlineId } : {}), ...(questId ? { questId } : {}), ...(intervalDays ? { intervalDays } : {}), ...(monthlyRule ? { monthlyRule } : {}), ...(!recurring && !monthlyRule && dueDate ? { dueDate } : {}), ...counterFields(counter) }] }));
        return id;
      },

      mergeRoutines: (keepId, dropId) =>
        set(s => {
          const keep = s.routines.find(r => r.id === keepId);
          const drop = s.routines.find(r => r.id === dropId);
          if (!keep || !drop || keepId === dropId) return {};

          // Nothing either copy earned is thrown away. The union of the days,
          // the better streak, the earlier creation date — a merge that loses
          // history is worse than the duplicate it cleans up.
          const days = [...new Set([...historyOf(s.taskHistory, keepId), ...historyOf(s.taskHistory, dropId)])].sort();
          const taskHistory = { ...s.taskHistory, [keepId]: days };
          delete taskHistory[dropId];

          const merged: Routine = {
            ...keep,
            systemIds: [...new Set([...routineSystemIds(keep), ...routineSystemIds(drop)])],
            systemId: undefined,
            questlineId: keep.questlineId ?? drop.questlineId,
            questId: keep.questlineId ? keep.questId : (keep.questId ?? drop.questId),
            anchor: keep.anchor || drop.anchor || undefined,
            streak: Math.max(keep.streak ?? 0, drop.streak ?? 0),
            createdAt: [keep.createdAt, drop.createdAt].filter(Boolean).sort()[0],
            // Done on either copy is done: ticking one of two rows and then
            // merging must not resurrect the task for the rest of the day.
            completed: keep.completed || drop.completed,
            completedAt: keep.completedAt ?? drop.completedAt,
            trackedToday: keep.trackedToday || drop.trackedToday,
            offToday: keep.offToday && drop.offToday ? true : undefined,
            subtasks: [...(keep.subtasks ?? []), ...(drop.subtasks ?? [])],
          };

          const todoOrder = { ...s.todoOrder };
          delete todoOrder[dropId];

          // The inverse is the three slices as they were. A merge touches all of
          // them together, and putting one back without the others would leave a
          // task with someone else's history.
          const before = { routines: s.routines, taskHistory: s.taskHistory, todoOrder: s.todoOrder };
          pushUndo(`Merged “${drop.title}” into “${keep.title}”`, () => set(() => before));
          return {
            routines: s.routines.filter(r => r.id !== dropId).map(r => (r.id === keepId ? merged : r)),
            taskHistory,
            todoOrder,
          };
        }),

      setRoutineDueDate: (rId, dueDate) =>
        set(s => ({ routines: mapById(s.routines, rId, r => ({ ...r, dueDate: dueDate ?? null })) })),

      addAnchorRoutine: (title, recurring, counter) => {
        const id = `r-${uid()}`;
        set(s => ({ routines: [...s.routines, { id, title, description: '', recurring, anchor: true, completed: false, trackedToday: recurring === 'daily', lastResetAt: new Date().toISOString(), createdAt: new Date().toISOString(), streak: 0, order: s.routines.length, ...counterFields(counter) }] }));
        return id;
      },

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
        set(s => {
          const index = s.routines.findIndex(r => r.id === rId);
          if (index < 0) return {};
          const routine = s.routines[index];
          // The streak is the part of a task that can't be rebuilt by re-typing
          // it, so name it when there is one.
          const streak = routine.streak ?? 0;
          pushUndo(
            deleteLabel(routine.title) + (streak > 1 ? ` · ${streak}-day streak` : ''),
            () => set(cur => ({ routines: reinsert(cur.routines, [{ index, item: routine }]) })),
          );
          return { routines: s.routines.filter(r => r.id !== rId) };
        }),

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
        set(s => {
          const before = s.routines.find(r => r.id === rId);
          const step = before && flattenSubtasks(before.subtasks).find(st => st.id === sId);
          if (!before || !step) return {};
          // Restores the tree and the roll-up it drove, and nothing else — a title
          // or schedule changed in the meantime is not this undo's business.
          const { subtasks, completed, completedAt } = before;
          pushUndo(deleteLabel(step.title), () =>
            set(cur => ({ routines: mapById(cur.routines, rId, r => ({ ...r, subtasks, completed, completedAt })) })));
          return mutateRoutine(s, rId, r => {
            const tree = removeNode(r.subtasks ?? [], sId);
            const all = flattenSubtasks(tree);
            const now = new Date().toISOString();
            // Deleting the last open step can complete the task; deleting every step
            // hands the decision back to the task's own checkbox.
            const done = all.length > 0 ? all.every(st => st.completed) : r.completed;
            return { ...r, subtasks: tree, completed: done, completedAt: done ? (r.completedAt ?? now) : undefined };
          });
        }),

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
              // Anchor and questline used to be exclusive — filing a habit under
              // a goal silently dropped it out of the anchor group. They are
              // different questions ("is this one of my core habits" vs "what is
              // it for"), so a task may now answer both.
            }
            if (u.questId !== undefined)                 next.questId = u.questId ?? undefined;
            if (u.dueDate !== undefined)                 next.dueDate = u.dueDate;
            // Counter: null removes it, a config (re)applies it. Existing progress is
            // clamped to the new target rather than wiped.
            if (u.counter !== undefined) {
              if (u.counter === null) {
                next.target = undefined; next.progress = undefined; next.step = undefined; next.unit = undefined;
                // No counter, no sessions to count.
                next.sessionDays = undefined; next.oncePerDay = undefined;
              } else if (u.counter.target > 0) {
                next.target   = Math.floor(u.counter.target);
                next.step     = u.counter.step && u.counter.step > 1 ? Math.floor(u.counter.step) : undefined;
                next.unit     = u.counter.unit?.trim() || undefined;
                next.progress = Math.min(next.target, r.progress ?? 0);
              }
            }
            if (u.oncePerDay !== undefined) next.oncePerDay = u.oncePerDay ?? undefined;
            // Switching a task into session mode re-derives its progress from the
            // days actually logged: carrying over a tapped-up number would import
            // exactly the overcount the mode exists to prevent.
            if (sessionMode(next) && !sessionMode(r)) {
              next.sessionDays = next.sessionDays ?? [];
              next.progress = Math.min(next.target ?? 0, next.sessionDays.length);
              next.completed = next.target != null && next.progress >= next.target;
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
            // Applied last, so it wins over the cadence branch above: if you both
            // change the schedule and set a streak in one save, the number you
            // typed is the one you meant.
            if (u.streak !== undefined) next.streak = Math.max(0, Math.floor(u.streak) || 0);
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

      toggleSession: (rId, dayKey) => set(s => sessionPatch(s, rId, dayKey)),

      incrementRoutine: (rId, delta) =>
        set(s => {
          const r0 = s.routines.find(r => r.id === rId);
          if (!r0 || r0.target == null) return {};
          // In session mode the counter's ＋/− mean "I did it today" / "I didn't",
          // and go through the very same day rule the strip uses. Without this the
          // buttons would still be a way to tap three gym visits into one
          // afternoon — the bug the mode exists to close.
          if (sessionMode(r0)) {
            const today = logicalDateKey();
            if ((delta > 0) === sessionOn(r0, today)) return {};   // already in the wanted state
            return sessionPatch(s, rId, today);
          }
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

      setRoutineProgress: (rId, value) =>
        set(s => {
          const r0 = s.routines.find(r => r.id === rId);
          if (!r0 || r0.target == null) return {};
          // Sessions are days, not a dial — a checkpoint tap has no meaning there.
          if (sessionMode(r0)) return {};
          return mutateRoutine(s, rId, r => {
            const next = Math.max(0, Math.min(r.target!, Math.round(value)));
            const rising = next > (r.progress ?? 0);
            const nowComplete = next >= r.target!;
            const now = new Date().toISOString();
            const hadSessionToday = !!r.lastProgressAt && logicalDateKey(new Date(r.lastProgressAt)) === logicalDateKey();
            return {
              ...r,
              progress: next,
              completed: nowComplete,
              completedAt: nowComplete ? (r.completedAt ?? now) : undefined,
              // Same rule the ＋/− follow: moving up marks today's session, moving
              // back down takes it away again.
              lastProgressAt: rising ? now : hadSessionToday ? undefined : r.lastProgressAt,
              skippedOn: rising ? undefined : r.skippedOn,
            };
          });
        }),

      // Toggles what the pin actually shows: on Today, or not. Writing only
      // `trackedToday` was not enough — for a daily habit, an anchor, or a goal
      // that field is ignored by `showsOnDay`, so the pin appeared to do nothing.
      // `offToday` is the explicit override those cases need; pinning back on
      // clears it, so the two can never disagree about the same task.
      toggleRoutineTracked: (rId) =>
        set(s => ({
          routines: mapById(s.routines, rId, r => (onToday(r)
            ? { ...r, trackedToday: false, offToday: true }
            : { ...r, trackedToday: true,  offToday: undefined })),
        })),

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

      // Notion pull only. Deliberately does not touch the completion log: the work
      // was recorded on the other side, and crediting it here would inflate the
      // heatmap on every pull. It still stamps completedAt so the data stays
      // consistent with every other completion path.
      setAllActionsComplete: (qlId, qId, complete) =>
        set(s => {
          const now = new Date().toISOString();
          return { questlines: mapQuest(s.questlines, qlId, qId, q => ({
            ...q,
            actions: q.actions.map(a => ({
              ...a,
              completed: complete,
              completedAt: complete ? (a.completedAt ?? now) : undefined,
            })),
          })) };
        }),

      // ── Systems ──────────────────────────────────────────────────────────────

      addSystem: (title, opts) => {
        const id = `sys-${uid()}`;
        const text = (v?: string) => v?.trim() || undefined;
        set(s => ({
          systems: [...s.systems, {
            id,
            title: title.trim() || 'New system',
            spaceId: opts?.spaceId,
            description: text(opts?.description),
            icon: opts?.icon || undefined,
            questlineIds: opts?.questlineIds ?? [],
            questIds: opts?.questIds ?? [],
            order: s.systems.length,
            createdAt: new Date().toISOString(),
          }],
        }));
        return id;
      },

      updateSystem: (sId, u) =>
        set(s => ({
          systems: s.systems.map(sys => {
            if (sys.id !== sId) return sys;
            const next: System = { ...sys };
            if ('spaceId' in u) next.spaceId = u.spaceId || undefined;
            // Each field is only touched when the caller sent it, so a drawer
            // that edits one thing can't blank the rest.
            if (u.title !== undefined && u.title.trim()) next.title = u.title.trim();
            if (u.description !== undefined) next.description = u.description.trim() || undefined;
            if (u.icon !== undefined)        next.icon = u.icon || undefined;
            // An empty array detaches every goal; undefined leaves them alone.
            if (u.questlineIds !== undefined) {
              next.questlineIds = u.questlineIds;
              next.questlineId = undefined;   // the legacy field is retired on write
            }
            if (u.questIds !== undefined)    next.questIds = u.questIds;
            if (u.hidden !== undefined)      next.hidden = u.hidden || undefined;
            return next;
          }),
        })),

      deleteSystem: (sId) =>
        set(s => ({
          systems: s.systems.filter(sys => sys.id !== sId),
          // The habits outlive the grouping — see the action's declaration. Only
          // this membership goes; the others the habit has are none of its business.
          routines: s.routines.map(r => {
            const ids = routineSystemIds(r);
            return ids.includes(sId) ? withSystems(r, ids.filter(x => x !== sId)) : r;
          }),
        })),

      setRoutineSystems: (rId, ids) =>
        set(s => ({ routines: mapById(s.routines, rId, r => withSystems(r, ids)) })),

      toggleRoutineSystem: (rId, sysId) =>
        set(s => ({
          routines: mapById(s.routines, rId, r => {
            const ids = routineSystemIds(r);
            return withSystems(r, ids.includes(sysId) ? ids.filter(x => x !== sysId) : [...ids, sysId]);
          }),
        })),

      addSystemAction: (systemId, title, recurring, intervalDays) =>
        set(s => {
          // The commonest way a habit ends up in the list twice: it already
          // exists, and naming it inside a system types it out again. That is a
          // request for this habit to be part of this system — which is now a
          // thing one task can be — so it joins rather than being re-created.
          const spaceId = s.systems.find(sys => sys.id === systemId)?.spaceId;
          const existing = s.routines.find(r => !r.hidden && sameTitle(r.title, title) && (
            routineSystemIds(r).length
              ? routineSystemIds(r).some(id => s.systems.some(sys => sys.id === id && sys.spaceId === spaceId))
              : !spaceId
          ));
          if (existing) {
            return {
              routines: mapById(s.routines, existing.id, r =>
                ({ ...r, systemIds: [...new Set([...routineSystemIds(r), systemId])], systemId: undefined })),
            };
          }
          return {
          routines: [...s.routines, {
            id: `r-${uid()}`,
            title: title.trim(),
            description: '',
            systemIds: [systemId],
            recurring,
            ...(intervalDays && intervalDays > 1 ? { intervalDays } : {}),
            completed: false,
            // Pinned on arrival: naming an action inside a system is saying you
            // intend to do it, so it starts on Today rather than waiting to be
            // found. The pin on the Systems page takes it back off.
            trackedToday: true,
            lastResetAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            streak: 0,
            order: s.routines.length,
          }],
          };
        }),
    }),
    { name: QUEST_STORE_KEY }
  )
);
