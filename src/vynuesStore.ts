import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { periodExpired, sameRule } from './store';
import { migrateLegacyStorage } from './lib/storageMigration';
import { flattenTree, mapNode, insertNode, removeNode } from './lib/subtree';
import { pushUndo, insertAt, reinsert, deleteLabel } from './lib/undo';
import type { RecurringType, MonthlyRule } from './types';

// Also called from ./store — whichever module loads first wins, and it's idempotent.
migrateLegacyStorage();

function uid() { return Math.random().toString(36).slice(2, 10); }

// Reuse the app's fixed accent palette (see index.css --color-*).
export type ProjectColor = 'crimson' | 'sapphire' | 'emerald' | 'amber' | 'violet';
export type ProjectStatus = 'active' | 'paused' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';
/** A task either happens once (null) or repeats on a cycle. */
export type TaskRecurrence = RecurringType | null;

/** Levels three-and-below of the hierarchy: Project → Task → Subtask → ….
 *  A subtask is a plain checklist step — it carries no schedule or priority of its
 *  own, since it inherits the timing of the task it belongs to. Subtasks nest
 *  without limit via `children`: any step can be split into smaller steps the
 *  moment you realise it wasn't the simplest version after all. Old saves (flat
 *  arrays) load unchanged — `children` is optional. */
export interface VynuesSubtask {
  id: string;
  title: string;
  done: boolean;
  children?: VynuesSubtask[];
}

// ── Recursive subtask-tree helpers ──────────────────────────────────────────
// The walks themselves live in lib/subtree.ts, shared with the quest store —
// only the leaf transform (this store's `done` field) is local.

/** Every node of a (possibly nested) subtask tree, flattened. */
export const flattenVynuesSubtasks = (list: VynuesSubtask[] | undefined): VynuesSubtask[] => flattenTree(list);

/** Set done on a node and its whole branch (checking a parent checks the branch). */
function setBranchDone(st: VynuesSubtask, done: boolean): VynuesSubtask {
  return { ...st, done, children: st.children?.map(c => setBranchDone(c, done)) };
}

export interface VynuesTask {
  id: string;
  title: string;
  done: boolean;
  /** ISO instant the task was last completed. Drives Today visibility for one-off
   *  tasks: a finished one-off stays on Today through its completion day, then drops
   *  off (it never resets, so it would otherwise linger there forever). */
  completedAt?: string;
  /** Checklist of smaller steps. Completion rolls up: ticking the last subtask
   *  completes the task, and un-ticking any subtask re-opens it. */
  subtasks?: VynuesSubtask[];
  priority: TaskPriority;
  dueDate?: string | null;
  notes?: string;
  createdAt: string;
  /** When set, the task repeats and `done` clears each cycle (rolls over at 5am). */
  recurring?: TaskRecurrence;
  /** Custom repeat interval in days (overrides `recurring` cadence; e.g. 21 = every 3 weeks). */
  intervalDays?: number;
  /** Calendar rule ("first Monday of the month"); overrides both fields above. */
  monthlyRule?: MonthlyRule | null;
  /** Start of the current cycle — drives reset, mirrors the quest store. */
  lastResetAt?: string;
  /** Consecutive completed cycles. */
  streak?: number;
  /** Pinned into the Today tab's "Tracked" section. */
  tracked?: boolean;
}

export interface VynuesProject {
  id: string;
  name: string;
  description: string;
  color: ProjectColor;
  status: ProjectStatus;
  tasks: VynuesTask[];
  createdAt: string;
}

/** localStorage key — kept separate from the quest store so Vynues data is isolated. */
export const VYNUES_STORE_KEY = 'milestone-vynues-v1';

// ── Category keys ───────────────────────────────────────────────────────────
// Today's task list is fed by two stores, so a Vynues project used as a category
// is prefixed to keep its id from colliding with a questline's.

const VYNUES_PREFIX = 'vynues:';

/** The Today-category key for a Vynues project. */
export const vynuesCategoryKey = (projectId: string) => `${VYNUES_PREFIX}${projectId}`;

/** The project id behind a category key, or null if it isn't a Vynues category. */
export const vynuesProjectId = (category: string): string | null =>
  category.startsWith(VYNUES_PREFIX) ? category.slice(VYNUES_PREFIX.length) : null;

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Project progress is measured in *tasks*, not subtasks — a task is the unit of work;
 *  its subtasks are just how it gets broken down. */
export function projectProgress(p: VynuesProject): { done: number; total: number } {
  return { done: p.tasks.filter(t => t.done).length, total: p.tasks.length };
}

/** Subtask tally for a task, counting every node of the nested tree
 *  ({done:0,total:0} when it has none). */
export function taskProgress(t: VynuesTask): { done: number; total: number } {
  const all = flattenVynuesSubtasks(t.subtasks);
  return { done: all.filter(s => s.done).length, total: all.length };
}

export interface VynuesDueInfo { text: string; urgency: 'ok' | 'soon' | 'urgent' | 'overdue'; }

/** Friendly relative deadline for a task due date.
 *  Handles both time-aware values (`YYYY-MM-DDTHH:mm`) and legacy date-only ones. */
export function getTaskDueInfo(dueDate: string): VynuesDueInfo {
  const hasTime = dueDate.includes('T');
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

  if (!hasTime) {
    // Legacy / date-only — day granularity.
    const days = Math.round((startOfDay(new Date(`${dueDate}T00:00:00`)) - startOfDay(new Date())) / 86_400_000);
    if (days < 0)  return { text: days === -1 ? 'Overdue 1d' : `Overdue ${-days}d`, urgency: 'overdue' };
    if (days === 0) return { text: 'Due today', urgency: 'urgent' };
    if (days === 1) return { text: 'Due tomorrow', urgency: 'urgent' };
    return { text: `Due in ${days}d`, urgency: days >= 7 ? 'ok' : 'soon' };
  }

  const due = new Date(dueDate);
  const ms = due.getTime() - Date.now();
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (ms < 0) {
    const mins = Math.floor(-ms / 60_000);
    if (mins < 60) return { text: `Overdue ${Math.max(1, mins)}m`, urgency: 'overdue' };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return { text: `Overdue ${hrs}h`, urgency: 'overdue' };
    return { text: `Overdue ${Math.floor(hrs / 24)}d`, urgency: 'overdue' };
  }

  const dayDiff = Math.round((startOfDay(due) - startOfDay(new Date())) / 86_400_000);
  if (dayDiff === 0) {
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return { text: `Due in ${Math.max(1, mins)}m`, urgency: 'urgent' };
    const hrs = Math.floor(mins / 60);
    if (hrs < 6)   return { text: `Due in ${hrs}h`, urgency: 'urgent' };
    return { text: `Today ${time}`, urgency: 'urgent' };
  }
  if (dayDiff === 1) return { text: `Tomorrow ${time}`, urgency: 'urgent' };
  if (dayDiff < 7)   return { text: `${due.toLocaleDateString([], { weekday: 'short' })} ${time}`, urgency: 'soon' };
  return { text: `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, urgency: 'ok' };
}

// ── Store ───────────────────────────────────────────────────────────────────

interface VynuesState {
  projects: VynuesProject[];

  /** Clears `done` on recurring tasks whose cycle has rolled over (5am boundary). */
  checkAndReset: () => void;

  addProject:    (name: string, description: string, color: ProjectColor) => void;
  updateProject: (id: string, updates: Partial<Pick<VynuesProject, 'name' | 'description' | 'color' | 'status'>>) => void;
  deleteProject: (id: string) => void;

  addTask:    (projectId: string, title: string, priority?: TaskPriority, dueDate?: string | null, recurring?: TaskRecurrence, intervalDays?: number, notes?: string, tracked?: boolean, subtasks?: string[], monthlyRule?: MonthlyRule | null) => void;
  toggleTask: (projectId: string, taskId: string) => void;
  toggleTaskTracked: (projectId: string, taskId: string) => void;
  updateTask: (projectId: string, taskId: string, updates: Partial<Pick<VynuesTask, 'title' | 'priority' | 'dueDate' | 'notes' | 'recurring' | 'tracked' | 'intervalDays' | 'monthlyRule'>>) => void;
  deleteTask: (projectId: string, taskId: string) => void;

  // ── Subtasks (Project → Task → Subtask → …, any depth) ──
  /** Add a subtask; pass `parentSubId` to nest it under an existing step. */
  addSubtask:    (projectId: string, taskId: string, title: string, parentSubId?: string | null) => void;
  toggleSubtask: (projectId: string, taskId: string, subtaskId: string) => void;
  renameSubtask: (projectId: string, taskId: string, subtaskId: string, title: string) => void;
  deleteSubtask: (projectId: string, taskId: string, subtaskId: string) => void;
}

/** Apply `fn` to one task inside one project, leaving everything else untouched. */
function mapTask(
  projects: VynuesProject[], projectId: string, taskId: string,
  fn: (t: VynuesTask) => VynuesTask,
): VynuesProject[] {
  return projects.map(p => p.id !== projectId ? p : {
    ...p, tasks: p.tasks.map(t => t.id !== taskId ? t : fn(t)),
  });
}

export const useVynuesStore = create<VynuesState>()(
  persist(
    (set) => ({
      projects: [],

      checkAndReset: () =>
        set(s => {
          const now = new Date().toISOString();
          let changed = false;
          const projects = s.projects.map(p => {
            let pChanged = false;
            const tasks = p.tasks.map(t => {
              if (!t.recurring && !t.intervalDays) return t;
              if (!t.lastResetAt) { pChanged = true; return { ...t, lastResetAt: now, streak: t.streak ?? 0 }; }
              if (periodExpired(t)) {
                pChanged = true;
                // Completed this cycle → extend streak; missed → reset to 0.
                // Subtasks come back unchecked with their parent.
                return {
                  ...t, done: false, completedAt: undefined, lastResetAt: now,
                  streak: t.done ? (t.streak ?? 0) + 1 : 0,
                  subtasks: t.subtasks?.map(st => setBranchDone(st, false)),
                };
              }
              return t;
            });
            if (!pChanged) return p;
            changed = true;
            return { ...p, tasks };
          });
          return changed ? { projects } : s;
        }),

      addProject: (name, description, color) =>
        set(s => ({
          projects: [
            ...s.projects,
            { id: `p-${uid()}`, name, description, color, status: 'active', tasks: [], createdAt: new Date().toISOString() },
          ],
        })),

      updateProject: (id, updates) =>
        set(s => ({ projects: s.projects.map(p => p.id !== id ? p : { ...p, ...updates }) })),

      deleteProject: (id) =>
        set(s => {
          const index = s.projects.findIndex(p => p.id === id);
          if (index < 0) return {};
          const project = s.projects[index];
          pushUndo(deleteLabel(project.name, [[project.tasks.length, 'task']]), () =>
            set(cur => ({ projects: cur.projects.some(p => p.id === id) ? cur.projects : insertAt(cur.projects, index, project) })));
          return { projects: s.projects.filter(p => p.id !== id) };
        }),

      addTask: (projectId, title, priority = 'medium', dueDate = null, recurring = null, intervalDays, notes, tracked, subtasks, monthlyRule) =>
        set(s => {
          const repeats = !!recurring || !!intervalDays || !!monthlyRule;
          // Daily/weekly tasks flow into Today automatically, so pinning is only for
          // the rest — a calendar rule surfaces on its own date, so it can be pinned.
          const canTrack = !!monthlyRule || (recurring !== 'daily' && recurring !== 'weekly');
          const subs = (subtasks ?? [])
            .map(x => x.trim())
            .filter(Boolean)
            .map(x => ({ id: `s-${uid()}`, title: x, done: false }));
          return {
            projects: s.projects.map(p => p.id !== projectId ? p : {
              ...p,
              tasks: [...p.tasks, {
                id: `t-${uid()}`, title, done: false, priority,
                // A repeating task ignores one-off due dates and starts its cycle now.
                dueDate: repeats ? null : dueDate,
                recurring,
                ...(intervalDays ? { intervalDays } : {}),
                ...(monthlyRule ? { monthlyRule } : {}),
                ...(notes?.trim() ? { notes: notes.trim() } : {}),
                ...(tracked && canTrack ? { tracked: true } : {}),
                ...(subs.length ? { subtasks: subs } : {}),
                lastResetAt: repeats ? new Date().toISOString() : undefined,
                streak: repeats ? 0 : undefined,
                createdAt: new Date().toISOString(),
              }],
            }),
          };
        }),

      // Ticking a parent task cascades down: everything under it is done too.
      toggleTask: (projectId, taskId) =>
        set(s => ({
          projects: mapTask(s.projects, projectId, taskId, t => {
            const done = !t.done;
            return {
              ...t, done,
              completedAt: done ? new Date().toISOString() : undefined,
              subtasks: t.subtasks?.map(st => setBranchDone(st, done)),
            };
          }),
        })),

      toggleTaskTracked: (projectId, taskId) =>
        set(s => ({
          projects: s.projects.map(p => p.id !== projectId ? p : {
            ...p, tasks: p.tasks.map(t => t.id !== taskId ? t : { ...t, tracked: !t.tracked }),
          }),
        })),

      updateTask: (projectId, taskId, updates) =>
        set(s => ({
          projects: s.projects.map(p => p.id !== projectId ? p : {
            ...p, tasks: p.tasks.map(t => {
              if (t.id !== taskId) return t;
              const next: VynuesTask = { ...t, ...updates };
              // When a caller sets the base cadence but supplies no custom interval, drop any
              // stale one so the chosen cadence (incl. "Once") actually takes effect instead of
              // the old "every N" silently winning in periodExpired/recurrenceLabel. A calendar
              // rule is cleared on the same terms — otherwise it would outrank the new choice.
              if (updates.recurring !== undefined && updates.intervalDays === undefined) next.intervalDays = undefined;
              if (updates.recurring !== undefined && updates.monthlyRule === undefined) next.monthlyRule = null;
              // (Re)start or clear the cycle bookkeeping only when the schedule really changed.
              const recurringChanged = (next.recurring ?? null) !== (t.recurring ?? null);
              const intervalChanged  = (next.intervalDays || undefined) !== (t.intervalDays || undefined);
              const ruleChanged      = !sameRule(next.monthlyRule, t.monthlyRule);
              if (recurringChanged || intervalChanged || ruleChanged) {
                const repeats = (next.recurring ?? null) !== null || !!next.intervalDays || !!next.monthlyRule;
                next.lastResetAt = repeats ? new Date().toISOString() : undefined;
                next.streak      = repeats ? (t.streak ?? 0) : undefined;
                if (repeats) next.dueDate = null; // repeating tasks don't use one-off due dates
              }
              return next;
            }),
          }),
        })),

      deleteTask: (projectId, taskId) =>
        set(s => {
          const project = s.projects.find(p => p.id === projectId);
          const index = project?.tasks.findIndex(t => t.id === taskId) ?? -1;
          if (!project || index < 0) return {};
          const task = project.tasks[index];
          pushUndo(deleteLabel(task.title), () =>
            set(cur => ({
              projects: cur.projects.map(p => p.id !== projectId ? p : { ...p, tasks: reinsert(p.tasks, [{ index, item: task }]) }),
            })));
          return {
            projects: s.projects.map(p => p.id !== projectId ? p : {
              ...p, tasks: p.tasks.filter(t => t.id !== taskId),
            }),
          };
        }),

      // ── Subtasks ──────────────────────────────────────────────────────────
      // Completion rolls *up*: a task is done exactly when every node of its
      // subtask tree is. Adding an open subtask to a finished task re-opens it.

      addSubtask: (projectId, taskId, title, parentSubId) =>
        set(s => {
          const t = title.trim();
          if (!t) return s;
          return {
            projects: mapTask(s.projects, projectId, taskId, task => ({
              ...task,
              done: false,
              completedAt: undefined,
              subtasks: insertNode(task.subtasks ?? [], parentSubId ?? null, { id: `s-${uid()}`, title: t, done: false }),
            })),
          };
        }),

      toggleSubtask: (projectId, taskId, subtaskId) =>
        set(s => ({
          projects: mapTask(s.projects, projectId, taskId, task => {
            const before = flattenVynuesSubtasks(task.subtasks).find(st => st.id === subtaskId);
            const checking = !before?.done;
            // Checking a parent step checks its whole branch; unchecking likewise.
            const subtasks = mapNode(task.subtasks ?? [], subtaskId, st => setBranchDone(st, checking));
            const all = flattenVynuesSubtasks(subtasks);
            const done = all.length > 0 && all.every(st => st.done);
            return { ...task, subtasks, done, completedAt: done ? (task.completedAt ?? new Date().toISOString()) : undefined };
          }),
        })),

      renameSubtask: (projectId, taskId, subtaskId, title) =>
        set(s => {
          const t = title.trim();
          if (!t) return s;
          return {
            projects: mapTask(s.projects, projectId, taskId, task => ({
              ...task,
              subtasks: mapNode(task.subtasks ?? [], subtaskId, st => ({ ...st, title: t })),
            })),
          };
        }),

      deleteSubtask: (projectId, taskId, subtaskId) =>
        set(s => {
          const task0 = s.projects.find(p => p.id === projectId)?.tasks.find(t => t.id === taskId);
          const step = task0 && flattenVynuesSubtasks(task0.subtasks).find(st => st.id === subtaskId);
          if (task0 && step) {
            // Restores the tree and the roll-up it drove — not the title or due
            // date, which are not this undo's business if they changed since.
            const { subtasks, done, completedAt } = task0;
            pushUndo(deleteLabel(step.title), () =>
              set(cur => ({ projects: mapTask(cur.projects, projectId, taskId, t => ({ ...t, subtasks, done, completedAt })) })));
          }
          return {
            projects: mapTask(s.projects, projectId, taskId, task => {
              const tree = removeNode(task.subtasks ?? [], subtaskId);
              const all = flattenVynuesSubtasks(tree);
              // Removing the last open subtask can complete the task; removing them all
              // hands the decision back to the task's own checkbox (left as-is).
              const isDone = all.length > 0 ? all.every(st => st.done) : task.done;
              return {
                ...task,
                subtasks: tree,
                done: isDone,
                completedAt: isDone ? (task.completedAt ?? new Date().toISOString()) : undefined,
              };
            }),
          };
        }),
    }),
    { name: VYNUES_STORE_KEY }
  )
);
