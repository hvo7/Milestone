/**
 * The Today tab: everything due right now, from every source, as one list.
 *
 * This page's job is *derivation* — normalising routines, quest actions, pinned
 * quests and Vynues tasks into a single row shape that can sort, filter, drag and
 * reorder together. The row itself, the drag plumbing and the surrounding
 * furniture live in components/today/; the "does this belong on this day"
 * predicates live in lib/today.ts, where the reminder scheduler and the tests can
 * reach them without rendering a page.
 */
import { useState, Suspense } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import type { Routine, Schedule, Action, Questline, System } from '../types';
import {
  useQuestStore, logicalDateKey, logicalDayStart, dateKey, dueOnDay, periodExpired, skipActive,
  isMultiDayCycle, isGoalRoutine, engagedOnDay, subtaskStats, repeats, isQuestComplete, questProgress, DAY_RESET_HOUR,
  sessionMode, cycleDayKeys, routineSystemIds,
} from '../store';
import { showsOnDay, vynuesShowsOnDay } from '../lib/today';
import { useVynuesStore, vynuesCategoryKey } from '../vynuesStore';
import { RecurrenceBadge } from '../recurrence';
import NavBar from '../components/NavBar';
import { lazyChunk } from '../lib/lazyChunk';
// The two drawers are the heaviest thing on this page and neither is on screen
// until the user asks for one — so they load on demand rather than sitting in
// the chunk that has to arrive before anything renders.
const TaskCreateDrawer = lazyChunk(() => import('../components/TaskCreateDrawer'));
const TaskEditDrawer = lazyChunk(() => import('../components/TaskEditDrawer'));
// `import type`, not `import { type ... }`: under verbatimModuleSyntax the latter
// still emits the import statement, which pins the module into this chunk and
// silently undoes the lazy() above.
import type { EditTarget } from '../components/TaskEditDrawer';
import type { SubNode, SubtaskTreeHandlers } from '../components/SubtaskTree';
import { categoryColor, cleanQuest, routineSubNodes, vynuesSubNodes, hasCheckpoints, ANCHOR_LABEL, ANCHOR_TAG, ANCHOR_ICON } from '../lib/ui';
import { MenuSelect } from '../vynuesUi';
import Heatmap from '../components/Heatmap';
import FirstRunCard from '../components/FirstRunCard';
import TaskRow, { type RowStrip, type SystemMenu } from '../components/today/TaskRow';
import { useReorder } from '../components/today/useReorder';
import { Caption, DueLabel, VynuesDueLabel } from '../components/today/labels';
import { ProgressSummary, Chip, DayFlipper } from '../components/today/chrome';

/** A quest's visible actions mapped into Today check-off steps. `forceOpen`
 *  renders them unchecked (tomorrow preview of a quest that will have reset). */
function actionSubNodes(actions: Action[], forceOpen: boolean): SubNode[] {
  return actions.filter(a => !a.hidden).map(a => ({ id: a.id, title: a.title, done: forceOpen ? false : a.completed }));
}

// ── Categories ────────────────────────────────────────────────────────────────

interface Category {
  key: string;
  label: string;
  color: string;
  icon?: string;
  tagLabel?: string;
  rank: number;
  /** Which half of the app the row came from. A system is a process you run; a
   *  quest is a goal or a one-off thing to finish. Everything else — loose
   *  tasks, anchor habits in no system, Vynues — is neither and shows only under
   *  "All". Drives the Systems / Quests filter. */
  kind: RowKind;
}

type RowKind = 'system' | 'quest' | 'other';

// Ranks order the chips. Systems sit straight after the anchor group and ahead
// of the goal-derived rows: the process you're running is the thing you act on.
// (Renumbered rather than squeezed in, so every existing pair keeps its order.)
const GENERAL_CATEGORY: Category = { key: 'general', label: 'General', color: 'var(--text-dim)', rank: 2, kind: 'other' };
const VYNUES_KEY = 'vynues';

/** A routine that belongs to a system files under it, so the day's list shows
 *  which process each action is part of rather than a flat pile of habits. */
const systemCategory = (sys: System): Category =>
  ({ key: sys.id, label: sys.title, color: 'var(--accent)', icon: sys.icon || '⚙️', rank: 1, kind: 'system' });

/** Every quest-derived row (a routine filed under a questline, a loose action, a
 *  pinned quest) files under its questline — same key, so they group together. */
const questlineCategory = (ql: Questline): Category =>
  ({ key: ql.id, label: ql.title, color: categoryColor(ql.color), rank: 3, kind: 'quest' });

// ── Main page ─────────────────────────────────────────────────────────────────

/** A task in the unified list, normalised across routines, quest actions and Vynues
 *  tasks so they all render, sort and reorder together. */
interface TodoItem {
  id: string;
  title: string;
  category: Category;
  /** Fully finished (the whole goal / the checkbox). */
  completed: boolean;
  /** Today's share of a multi-day goal is done — the row settles into the
   *  Completed group for today and counts toward the day's progress, even though
   *  the weekly goal itself is still open. */
  todayDone: boolean;
  skipped?: boolean;
  onSkip?: () => void;
  streak?: number;
  accentHex: string;
  meta?: React.ReactNode;
  target?: number;
  progress?: number;
  step?: number;
  unit?: string;
  onIncrement?: (delta: number) => void;
  /** Day strip / checkpoint ladder drawn under this row, where it applies. */
  strip?: RowStrip;
  subtasks?: SubNode[];
  subHandlers?: SubtaskTreeHandlers;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** Opens the full edit drawer for this task. */
  editTarget?: EditTarget;
  /** Tag-click menu for reassigning this row's system. Routines only — quest
   *  actions and Vynues tasks have no system to belong to. */
  systemMenu?: SystemMenu;
}

export default function Today() {
  const questlines     = useQuestStore(s => s.questlines);
  const routines       = useQuestStore(s => s.routines);
  const systems        = useQuestStore(s => s.systems);
  const setRoutineSystems = useQuestStore(s => s.setRoutineSystems);
  const toggleRoutineSystem = useQuestStore(s => s.toggleRoutineSystem);
  const deleteRoutine  = useQuestStore(s => s.deleteRoutine);
  const reorderTodo    = useQuestStore(s => s.reorderTodo);
  const todoOrder      = useQuestStore(s => s.todoOrder);
  const toggleRoutine  = useQuestStore(s => s.toggleRoutine);
  const skipRoutine    = useQuestStore(s => s.skipRoutine);
  const incrementRoutine = useQuestStore(s => s.incrementRoutine);
  const toggleSession    = useQuestStore(s => s.toggleSession);
  const setRoutineProgress = useQuestStore(s => s.setRoutineProgress);
  const toggleAction   = useQuestStore(s => s.toggleAction);
  const toggleTracked  = useQuestStore(s => s.toggleTracked);
  const deleteAction   = useQuestStore(s => s.deleteAction);
  const addAction            = useQuestStore(s => s.addAction);
  const toggleQuestTracked   = useQuestStore(s => s.toggleQuestTracked);
  const setQuestComplete     = useQuestStore(s => s.setQuestComplete);
  const updateQuestTitle     = useQuestStore(s => s.updateQuestTitle);
  const addRoutineSubtask    = useQuestStore(s => s.addRoutineSubtask);
  const toggleRoutineSubtask = useQuestStore(s => s.toggleRoutineSubtask);
  const renameRoutineSubtask = useQuestStore(s => s.renameRoutineSubtask);
  const deleteRoutineSubtask = useQuestStore(s => s.deleteRoutineSubtask);
  const updateRoutineTitle   = useQuestStore(s => s.updateRoutineTitle);
  const updateActionTitle    = useQuestStore(s => s.updateActionTitle);

  // Vynues — project tasks flow into the same list, tagged with their project.
  const vynuesProjects     = useVynuesStore(s => s.projects);
  const toggleVynuesTask   = useVynuesStore(s => s.toggleTask);
  const updateVynuesTask   = useVynuesStore(s => s.updateTask);
  const deleteVynuesTask   = useVynuesStore(s => s.deleteTask);
  const addVynuesSubtask   = useVynuesStore(s => s.addSubtask);
  const toggleVynuesSubtask = useVynuesStore(s => s.toggleSubtask);
  const renameVynuesSubtask = useVynuesStore(s => s.renameSubtask);
  const deleteVynuesSubtask = useVynuesStore(s => s.deleteSubtask);

  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState<RowKind | 'all'>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState('');
  const [drawerSystem, setDrawerSystem] = useState('');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const dragTodo = useReorder(reorderTodo);

  const byOrder = <T extends { order?: number }>(arr: T[]) =>
    arr.map((r, i) => ({ r, i })).sort((a, b) => (a.r.order ?? a.i) - (b.r.order ?? b.i)).map(x => x.r);

  // ── Day selector: today, or a live preview of tomorrow ─────────────────────
  const [preview, setPreview] = useState(false);
  const todayKey  = logicalDateKey();
  const viewStart = logicalDayStart();
  if (preview) viewStart.setDate(viewStart.getDate() + 1);
  const viewKey   = preview ? dateKey(viewStart) : todayKey;
  const viewProbe = new Date(viewStart.getTime() + (DAY_RESET_HOUR + 1) * 3_600_000);
  const willReset = (s: Schedule) => preview && periodExpired(s, viewProbe);

  // Subtask handler bundle for a routine row.
  const routineSubProps = (r: Routine) => {
    const reset = willReset(r);
    return {
      subtasks: routineSubNodes(r.subtasks, reset),
      subHandlers: {
        onAdd: (t: string, parentId: string | null) => addRoutineSubtask(r.id, t, parentId),
        onToggle: preview ? undefined : (sId: string) => toggleRoutineSubtask(r.id, sId),
        onRename: (sId: string, t: string) => renameRoutineSubtask(r.id, sId, t),
        onDelete: (sId: string) => deleteRoutineSubtask(r.id, sId),
      } as SubtaskTreeHandlers,
    };
  };

  const counterOf = (r: Routine) => ({
    target: r.target,
    progress: r.target != null && willReset(r) ? 0 : r.progress,
    step: r.step, unit: r.unit,
    onIncrement: r.target != null ? (d: number) => incrementRoutine(r.id, d) : undefined,
  });

  /**
   * What to draw under this row — a day strip, a checkpoint ladder, or nothing.
   *
   * Deliberately narrow. A goal that counts days ("gym 3× a week") gets the
   * strip; a counter you chip at in fixed portions ("64 oz", step 16) gets the
   * ladder; everything else — plain checkboxes, one-offs, fine-grained counters
   * with too many rungs to tap — grows nothing at all.
   *
   * Suppressed in the tomorrow preview, where the row is read-only and a strip
   * showing today's sessions on tomorrow's card would simply be wrong.
   */
  const stripOf = (r: Routine): RowStrip | undefined => {
    if (preview || r.target == null) return undefined;
    if (sessionMode(r)) {
      const days = cycleDayKeys(r);
      // A cycle too long to draw (monthly) still enforces one-per-day; it just
      // has no readable strip, so the counter stands on its own.
      if (!days) return undefined;
      return {
        kind: 'sessions',
        days,
        logged: (r.sessionDays ?? []).filter(d => days.includes(d)),
        onToggle: (dayKey: string) => toggleSession(r.id, dayKey),
      };
    }
    if (!hasCheckpoints(r.target, r.step ?? 1)) return undefined;
    return { kind: 'checkpoints', onSet: (value: number) => setRoutineProgress(r.id, value) };
  };

  // Skips are day-scoped now: today's skip never spills into tomorrow, so the
  // preview simply shows everything unskipped.
  const skipOf = (r: Routine) => preview
    ? { skipped: false, onSkip: undefined }
    : { skipped: skipActive(r, todayKey), onSkip: () => skipRoutine(r.id) };

  // The recurrence badge / due pill / goal hint under a routine's title.
  //
  // The cycle count is only added for a goal made of *steps*. A goal with a
  // target already prints its figure on the counter itself, and again on the day
  // strip underneath — so adding it here made "0/3 this cycle" the second and
  // third copy of one number on a row 300px wide.
  const routineMeta = (r: Routine) => {
    const bits: React.ReactNode[] = [];
    if (repeats(r)) bits.push(<RecurrenceBadge key="rec" recurring={r.recurring} intervalDays={r.intervalDays} monthlyRule={r.monthlyRule} />);
    else if (r.dueDate) bits.push(<DueLabel key="due" dueDate={r.dueDate} todayKey={viewKey} />);
    if (!preview && isGoalRoutine(r) && !r.completed && r.target == null) {
      const stats = subtaskStats(r.subtasks);
      bits.push(
        <Caption key="goal">{stats.done}/{stats.total} this cycle</Caption>
      );
    }
    if (!bits.length) return undefined;
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{bits}</span>;
  };

  // ── Sources ────────────────────────────────────────────────────────────────
  const onToday = byOrder(routines.filter(r => !r.hidden && showsOnDay(r, viewKey, viewStart)));
  // The anchor group is a place on this page, not a category in the list: a task
  // marked for it shows there and *only* there. Exclusive on purpose — the point
  // of the section is that those few things sit apart from the day's churn, which
  // a duplicate row in the list below would undo.
  const anchorRoutines = onToday.filter(r => r.anchor);
  const liveRoutines = onToday.filter(r => !r.anchor);

  const categoryOfRoutine = (r: Routine): Category => {
    // System first: it's the grouping you chose deliberately, and it's more
    // specific than "this is an anchor habit" or "this serves that goal".
    // A habit can be in several systems. The day's list is a list of things to
    // do, so it shows the habit once and names one system — how it's filed is a
    // question for the Systems page, and a "+2" on the row is an answer to a
    // question nobody asks while working through the day.
    const sys = routineSystemIds(r)
      .map(sid => systems.find(s => s.id === sid))
      .find((s): s is System => !!s);
    if (sys) return systemCategory(sys);
    const ql = r.questlineId ? questlines.find(q => q.id === r.questlineId) : undefined;
    return ql ? questlineCategory(ql) : GENERAL_CATEGORY;
  };

  // Quests pinned as a whole surface on Today as one item each (their actions ride
  // along as check-off steps). A pinned quest always shows while pinned.
  const pinnedQuests = questlines.flatMap(ql =>
    ql.quests
      .filter(q => !q.hidden && q.trackedToday)
      .map(quest => ({ quest, ql }))
  );

  const questActions = questlines.flatMap(ql =>
    ql.quests.flatMap(q =>
      // A quest pinned as a unit owns its actions on Today (they show nested under
      // it), so they must not also appear as standalone rows.
      q.trackedToday && !q.hidden
        ? []
        : q.actions
            .filter(a => {
              if (a.hidden) return false;
              if (!repeats(a)) return !!a.trackedToday;
              if (a.recurring === 'daily' && !a.intervalDays && !a.monthlyRule) return true;
              return !!a.trackedToday || dueOnDay(a, viewStart);
            })
            .map(a => ({ action: a, quest: q, ql, pinned: !repeats(a) }))
    )
  );

  const vynuesItems = vynuesProjects.flatMap(p =>
    p.tasks
      .filter(t => (p.status === 'active' || t.tracked) && vynuesShowsOnDay(t, viewKey, viewStart))
      .map(task => ({ task, project: p }))
  );

  // ── The one list ───────────────────────────────────────────────────────────

  /** A routine as a row. Shared with the anchor section, which is a different
   *  place on the page but the same task: same streak, same skip, same counter,
   *  same edit drawer. */
  const routineItem = (r: Routine): TodoItem => {
      const reset = willReset(r);
      const fullyDone = reset ? false : r.completed;
      // A weekly "gym 3×" goal with a session logged today is done *for today* —
      // it counts in the bar and settles into the Completed group, while the goal
      // itself stays open for the rest of the cycle.
      const todayDone = !preview && !fullyDone && isMultiDayCycle(r) && !skipActive(r, todayKey) && engagedOnDay(r, viewKey);
      const cat = categoryOfRoutine(r);
      return {
        id: r.id,
        title: r.title,
        category: cat,
        completed: fullyDone,
        todayDone,
        streak: r.streak,
        accentHex: fullyDone || todayDone ? 'var(--success)' : cat.color,
        meta: routineMeta(r),
        strip: stripOf(r),
        ...counterOf(r),
        ...skipOf(r),
        ...routineSubProps(r),
        onToggle: () => { if (!preview) toggleRoutine(r.id); },
        onRename: (t: string) => updateRoutineTitle(r.id, t),
        onDelete: () => deleteRoutine(r.id),
        editTarget: { kind: 'routine', id: r.id } as EditTarget,
        // Attaching a habit to a system is a thought you have while looking at
        // the day's list, so the row's own tag does it. Only offered when a
        // system exists to put it in, and never in the tomorrow preview.
        systemMenu: (!preview && systems.length > 0)
          ? {
              options: systems.filter(sys => !sys.hidden)
                .map(sys => ({ id: sys.id, label: `${sys.icon || '⚙️'} ${sys.title}` })),
              values: routineSystemIds(r),
              onToggle: (sysId: string) => toggleRoutineSystem(r.id, sysId),
              onClear: () => setRoutineSystems(r.id, []),
            } satisfies SystemMenu
          : undefined,
      };
  };

  const todoItems: TodoItem[] = [
    ...liveRoutines.map(routineItem),
    ...questActions.map(({ action, quest, ql, pinned }) => {
      const done = willReset(action) ? false : action.completed;
      return {
        id: action.id,
        title: action.title,
        category: questlineCategory(ql),
        completed: done,
        todayDone: false,
        accentHex: done ? 'var(--success)' : categoryColor(ql.color),
        meta: <RecurrenceBadge recurring={action.recurring} intervalDays={action.intervalDays} monthlyRule={action.monthlyRule} />,
        onToggle: () => { if (!preview) toggleAction(ql.id, quest.id, action.id); },
        onRename: (t: string) => updateActionTitle(ql.id, quest.id, action.id, t),
        onDelete: () => pinned
          ? toggleTracked(ql.id, quest.id, action.id)
          : deleteAction(ql.id, quest.id, action.id),
        editTarget: { kind: 'action', qlId: ql.id, qId: quest.id, aId: action.id } as EditTarget,
      };
    }),
    ...pinnedQuests.map(({ quest, ql }): TodoItem => {
      const reset = willReset(quest);
      const done = reset ? false : isQuestComplete(quest);
      const { done: ad, total: at } = questProgress(quest);
      const cat = questlineCategory(ql);
      return {
        id: quest.id,
        title: cleanQuest(quest.title),
        category: cat,
        completed: done,
        todayDone: false,
        streak: quest.streak,
        accentHex: done ? 'var(--success)' : cat.color,
        meta: repeats(quest)
          ? <RecurrenceBadge recurring={quest.recurring} intervalDays={quest.intervalDays} monthlyRule={quest.monthlyRule} />
          : at > 0
            ? <Caption>Quest · {ad}/{at} tasks</Caption>
            : <Caption>Quest</Caption>,
        subtasks: actionSubNodes(quest.actions, reset),
        subHandlers: {
          onAdd: (t: string) => addAction(ql.id, quest.id, t),
          onToggle: preview ? undefined : (aId: string) => toggleAction(ql.id, quest.id, aId),
          onRename: (aId: string, t: string) => updateActionTitle(ql.id, quest.id, aId, t),
          onDelete: (aId: string) => deleteAction(ql.id, quest.id, aId),
        } as SubtaskTreeHandlers,
        // The parent checkbox completes (or reopens) the whole quest at once.
        onToggle: () => { if (!preview) setQuestComplete(ql.id, quest.id, !isQuestComplete(quest)); },
        onRename: (t: string) => updateQuestTitle(ql.id, quest.id, t),
        // ✕ on a pinned quest unpins it from Today rather than deleting the quest.
        onDelete: () => toggleQuestTracked(ql.id, quest.id),
      };
    }),
    ...vynuesItems.map(({ task, project }) => {
      const reset = willReset(task);
      const done = reset ? false : task.done;
      return {
        id: task.id,
        title: task.title,
        category: {
          key: VYNUES_KEY, label: 'Vynues', tagLabel: project.name,
          color: categoryColor(project.color), icon: '🚩', rank: 4, kind: 'other' as const,
        },
        completed: done,
        todayDone: false,
        streak: task.streak,
        accentHex: done ? 'var(--success)' : categoryColor(project.color),
        meta: repeats(task)
          ? <RecurrenceBadge recurring={task.recurring} intervalDays={task.intervalDays} monthlyRule={task.monthlyRule} />
          : task.dueDate
            ? <VynuesDueLabel dueDate={task.dueDate} />
            : undefined,
        subtasks: vynuesSubNodes(task.subtasks, reset),
        subHandlers: {
          onAdd: (t: string, parentId: string | null) => addVynuesSubtask(project.id, task.id, t, parentId),
          onToggle: preview ? undefined : (sId: string) => toggleVynuesSubtask(project.id, task.id, sId),
          onRename: (sId: string, t: string) => renameVynuesSubtask(project.id, task.id, sId, t),
          onDelete: (sId: string) => deleteVynuesSubtask(project.id, task.id, sId),
        } as SubtaskTreeHandlers,
        onToggle: () => { if (!preview) toggleVynuesTask(project.id, task.id); },
        onRename: (t: string) => updateVynuesTask(project.id, task.id, { title: t }),
        onDelete: () => deleteVynuesTask(project.id, task.id),
        editTarget: { kind: 'vynues', projectId: project.id, taskId: task.id } as EditTarget,
      };
    }),
  ];

  // ── Chips ──────────────────────────────────────────────────────────────────
  const settledOf = (it: TodoItem) => it.completed || it.todayDone;

  // The Systems / Quests split is applied before everything else: the chips, the
  // counts and the list all describe the half you're looking at.
  const kindItems = kind === 'all' ? todoItems : todoItems.filter(it => it.category.kind === kind);
  const kindCounts = {
    all: todoItems.length,
    system: todoItems.filter(it => it.category.kind === 'system').length,
    quest: todoItems.filter(it => it.category.kind === 'quest').length,
  };

  const chips = [...kindItems
    .reduce((acc, it) => {
      const c = acc.get(it.category.key) ?? { category: it.category, open: 0, total: 0 };
      c.total += 1;
      if (!settledOf(it)) c.open += 1;
      acc.set(it.category.key, c);
      return acc;
    }, new Map<string, { category: Category; open: number; total: number }>())
    .values()]
    .sort((a, b) => a.category.rank - b.category.rank || a.category.label.localeCompare(b.category.label));

  const activeExists = filter === 'all' || chips.some(c => c.category.key === filter);
  const visible = filter === 'all' || !activeExists
    ? kindItems
    : kindItems.filter(it => it.category.key === filter);

  // Order: manual todoOrder first (by value), then anything new by source rank.
  const order = todoOrder ?? {};
  const rankOf = new Map(todoItems.map((it, i) => [it.id, i]));
  const cmpTodo = (a: TodoItem, b: TodoItem) => {
    const ao = order[a.id], bo = order[b.id];
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0);
  };
  const todoOpen = visible
    .filter(it => !settledOf(it))
    .sort((a, b) => Number(!!a.skipped) - Number(!!b.skipped) || cmpTodo(a, b));
  // Today's settled work: fully-completed tasks and multi-day goals with today's
  // session logged. The latter keep their counters live so another session can be
  // stacked on the same day.
  const todoDone = visible.filter(settledOf).sort(cmpTodo);

  // Drag-to-reorder only makes sense over the unfiltered (or trivially filtered) list —
  // reordering within a filtered subset would silently reshuffle items the user can't see.
  const dragEnabled = filter === 'all' || !activeExists;
  const dragIds = todoOpen.map(x => x.id);
  const orderedIds = dragEnabled ? dragTodo.orderOf(dragIds) : dragIds;
  const byId = new Map(todoOpen.map(it => [it.id, it] as const));
  const orderedTodoOpen = orderedIds.map(id => byId.get(id)).filter((it): it is TodoItem => !!it);

  /** Keyboard reordering: swap with the neighbour and persist immediately.
   *  Unlike a drag there's no in-flight state to hold — each press is a complete
   *  move, so the store is the only place the order needs to live. */
  const moveTodo = (id: string, delta: number) => {
    const ids = [...orderedIds];
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorderTodo(ids);
  };

  const todoRows = orderedTodoOpen.map(it => (
    <TaskRow
      key={it.id}
      title={it.title}
      tag={{ label: it.category.tagLabel ?? it.category.label, color: it.category.color }}
      systemMenu={it.systemMenu}
      completed={false}
      streak={it.streak}
      accentHex={it.accentHex}
      sourceLine={it.meta}
      skipped={it.skipped}
      onSkip={it.onSkip}
      onToggle={it.onToggle}
      onDelete={it.onDelete}
      onRename={it.onRename}
      onEdit={it.editTarget ? () => setEditTarget(it.editTarget!) : undefined}
      drag={dragEnabled ? {
        value: it.id,
        onDragStart: dragTodo.onDragStart,
        onDrag: dragTodo.onDrag,
        onDragEnd: dragTodo.onDragEnd,
        onMoveUp: () => moveTodo(it.id, -1),
        onMoveDown: () => moveTodo(it.id, 1),
      } : undefined}
      target={it.target}
      progress={it.progress}
      step={it.step}
      unit={it.unit}
      onIncrement={it.onIncrement}
      strip={it.strip}
      readOnly={preview}
      subtasks={it.subtasks}
      subHandlers={it.subHandlers}
    />
  ));

  // The anchor section, built through the same row builder as the list — so its
  // tasks keep their streaks, skips, counters, steps and edit drawer rather than
  // becoming a checkbox with a name beside it.
  const anchorItems = anchorRoutines.map(routineItem);
  const anchorDone = anchorItems.filter(settledOf).length;
  const done  = todoDone.length + anchorDone;
  const total = visible.filter(it => !it.skipped).length + anchorItems.filter(it => !it.skipped).length;
  const activeChip = chips.find(c => c.category.key === filter);
  const progressLabel = activeChip ? activeChip.category.label : preview ? "Tomorrow's plan" : "Today's progress";

  function openDrawer() {
    const key = activeChip?.category.key;
    const firstProject = vynuesProjects.find(p => p.status === 'active');
    // A system chip is not a questline: filing the new task under `key` would
    // hand a system id to the questline field. It presets the system instead.
    const system = key && systems.some(sys => sys.id === key) ? key : '';
    const preset =
      system                              ? '' :
      key === VYNUES_KEY                  ? (firstProject ? vynuesCategoryKey(firstProject.id) : '') :
      key && key !== GENERAL_CATEGORY.key ? key :
                                            '';
    setDrawerCategory(preset);
    setDrawerSystem(system);
    setDrawerOpen(true);
  }

  const dateHeading = viewStart.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="page-shell" style={{ paddingBottom: 80 }}>
      <NavBar />

      <div className="today-shell">

        {/* ── The anchor group, as a place rather than a category ──────────────
            Off to the side and always in view: the few things you want in front
            of you every day, whatever else the day turned out to hold. */}
        {anchorRoutines.length > 0 && (
          <aside className="today-rail">
            <div className="parchment" style={{ borderRadius: 14, padding: '14px 16px' }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span>{ANCHOR_ICON}</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ANCHOR_LABEL}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--page-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                  {anchorDone}/{anchorRoutines.length}
                </span>
              </h2>
              {/* The same row as the list below — no tag, because the box it sits
                  in is the label. Everything else it can do, it still does. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {anchorItems.map(it => (
                  <TaskRow
                    key={it.id}
                    compact
                    title={it.title}
                    completed={it.completed}
                    todayDone={it.todayDone}
                    streak={it.streak}
                    accentHex={it.accentHex}
                    sourceLine={it.meta}
                    skipped={it.skipped}
                    onSkip={it.onSkip}
                    onToggle={it.onToggle}
                    onDelete={it.onDelete}
                    onRename={it.onRename}
                    onEdit={it.editTarget ? () => setEditTarget(it.editTarget!) : undefined}
                    target={it.target}
                    progress={it.progress}
                    step={it.step}
                    unit={it.unit}
                    onIncrement={it.onIncrement}
                    strip={it.strip}
                    readOnly={preview}
                    subtasks={it.subtasks}
                    subHandlers={it.subHandlers}
                  />
                ))}
              </div>
            </div>
          </aside>
        )}

        <div className="today-main">
        <AnimatePresence mode="wait" initial={false} custom={preview ? 1 : -1}>
        <motion.div
          key={preview ? 'tomorrow' : 'today'}
          custom={preview ? 1 : -1}
          variants={{
            enter:  (dir: number) => ({ x: dir * 90, opacity: 0 }),
            center: { x: 0, opacity: 1 },
            exit:   (dir: number) => ({ x: dir * -90, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        >

        <header style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
            {preview ? 'Planning ahead' : 'Today'}
          </p>
          <h1 className="page-title" style={{ margin: '2px 0 0' }}>{dateHeading}</h1>
        </header>

        {preview && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
            padding: '10px 14px', borderRadius: 12,
            border: '1px dashed var(--accent-border)', background: 'var(--accent-soft)',
          }}>
            <span style={{ fontSize: 16 }}>🌅</span>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--page-text)' }}>
              <strong>Tomorrow, previewed</strong>
            </p>
          </div>
        )}

        {/* Shows only on a genuinely empty app, and takes the place of the
            progress bar — "0/0 done" is not a useful first impression. */}
        <FirstRunCard onCreate={openDrawer} />
        {(questlines.length > 0 || routines.length > 0) && (
          <ProgressSummary label={progressLabel} done={done} total={total} />
        )}

        {/* ── One list, everything in it ──────────────────────────────────── */}
        <section style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--page-text)' }}>{preview ? 'To Do — tomorrow' : 'To Do'}</h2>
            <button
              onClick={openDrawer}
              className="btn-gold"
              style={{ marginLeft: 'auto', padding: '7px 15px', fontSize: 12.5 }}
            >
              ＋ New task
            </button>
          </div>

          {/* One row of filters: everything, or one of the two halves — a system
              is a process you run, a quest is a goal or a one-off to finish —
              and a dropdown for a single questline or system. The per-category
              chips used to be spelled out here, which by seven questlines was
              three lines of chrome above a list of five tasks. */}
          <div className="chip-row" style={{ alignItems: 'center' }}>
            <Chip
              label="All"
              open={todoItems.filter(it => !settledOf(it)).length}
              total={todoItems.length}
              active={kind === 'all' && (filter === 'all' || !activeExists)}
              onClick={() => { setKind('all'); setFilter('all'); }}
            />
            {([['system', 'Systems'], ['quest', 'Quests']] as const).map(([k, label]) => (
              kindCounts[k] > 0 && (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  data-active={kind === k}
                  onClick={() => { setKind(kind === k ? 'all' : k); setFilter('all'); }}
                >
                  <span>{label}</span>
                  <span className="chip-count">{kindCounts[k]}</span>
                </button>
              )
            ))}
            {chips.length > 1 && (
              <span style={{ minWidth: 170, marginLeft: 'auto' }}>
                <MenuSelect
                  label="Filter"
                  value={activeExists ? filter : 'all'}
                  onChange={(v: string) => setFilter(v)}
                  options={[
                    { key: 'all', label: kind === 'all' ? 'Everything' : `All ${kind === 'system' ? 'systems' : 'quests'}` },
                    ...chips.map(c => ({ key: c.category.key, label: `${c.category.label} · ${c.open}` })),
                  ]}
                />
              </span>
            )}
          </div>

          <div style={{ height: 1, background: 'var(--card-border)', marginBottom: 14 }} />

          {dragEnabled ? (
            <Reorder.Group
              as="div"
              axis="y"
              values={orderedIds}
              onReorder={dragTodo.onReorder}
              // Rows are spaced with `gap` rather than their own margin so that
              // the boxes framer measures sit flush against each other.
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <AnimatePresence initial={false}>
                {todoRows}
              </AnimatePresence>
            </Reorder.Group>
          ) : (
            <AnimatePresence initial={false}>
              {todoRows}
            </AnimatePresence>
          )}

          {todoDone.length > 0 && (
            <>
              <p style={{ margin: '18px 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--page-text-dim)' }}>
                Done for today · {todoDone.length}
              </p>
              <AnimatePresence initial={false}>
                {todoDone.map(it => (
                  <TaskRow
                    key={it.id}
                    title={it.title}
                    tag={{ label: it.category.tagLabel ?? it.category.label, color: it.category.color }}
                    systemMenu={it.systemMenu}
                    completed={it.completed}
                    todayDone={it.todayDone}
                    streak={it.streak}
                    accentHex="var(--success)"
                    sourceLine={it.meta}
                    onToggle={it.onToggle}
                    onRename={it.onRename}
                    onEdit={it.editTarget ? () => setEditTarget(it.editTarget!) : undefined}
                    target={it.target}
                    progress={it.progress}
                    step={it.step}
                    unit={it.unit}
                    onIncrement={it.onIncrement}
                    strip={it.strip}
                    readOnly={preview}
                  />
                ))}
              </AnimatePresence>
            </>
          )}

          {/* Suppressed on a first run, where FirstRunCard above already explains
              the empty screen — two "nothing here yet" messages read as a fault. */}
          {todoItems.length === 0 && (questlines.length > 0 || routines.length > 0) && (
            <p style={{ fontSize: 13, color: 'var(--page-text-dim)', padding: '14px 0', lineHeight: 1.7 }}>
              {preview
                ? <>Nothing on tomorrow’s plate yet. Hit <strong>＋ New task</strong> to plan ahead.</>
                : <>A clear day ahead. Hit <strong>＋ New task</strong> to add one — General by default, or file it under a questline, Vynues project, or your {ANCHOR_TAG} habits.</>}
            </p>
          )}

          {todoItems.length > 0 && todoOpen.length === 0 && (
            <motion.p
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ fontSize: 13, color: 'var(--success)', textAlign: 'center', padding: '18px 0 4px', margin: 0, fontWeight: 600 }}
            >
              {preview ? 'Tomorrow is already squared away. 🌅' : 'Everything here is done. 🔥'}
            </motion.p>
          )}
        </section>

        </motion.div>
        </AnimatePresence>

        <Heatmap />
        </div>
      </div>

      {/* ── Day flipper ──────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        <DayFlipper key={preview ? 'flip-back' : 'flip-fwd'} forward={!preview} onClick={() => setPreview(!preview)} />
      </AnimatePresence>

      {/* No fallback: a drawer slides in over the page, so an empty frame for the
          moment it takes to arrive is exactly the right thing to show. */}
      <Suspense fallback={null}>
        {drawerOpen && <TaskCreateDrawer open={drawerOpen} initialCategory={drawerCategory} initialSystem={drawerSystem} onClose={() => setDrawerOpen(false)} />}
        {editTarget && <TaskEditDrawer target={editTarget} onClose={() => setEditTarget(null)} />}
      </Suspense>
    </div>
  );
}
