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
import { atResetTime, useUIStore } from '../uiStore';
import { useLayoutEffect, useRef, useState, Suspense, type ReactNode } from 'react';
import { pushUndo } from '../lib/undo';
import { AnimatePresence, Reorder } from 'framer-motion';
import type { Routine, Schedule, Action, Questline, Quest, System } from '../types';
import {
  useQuestStore, logicalDateKey, logicalDayStart, dateKey, periodExpired, skipActive,
  isMultiDayCycle, isGoalRoutine, engagedOnDay, subtaskStats, repeats, isQuestComplete, questProgress,
  sessionMode, cycleDayKeys, routineSystemIds,
} from '../store';
import { showsOnDay, vynuesShowsOnDay, actionShowsOnDay, questShowsOnDay, dueDateMatchesDay, activeTasksFirst } from '../lib/today';
import { useVynuesStore, vynuesCategoryKey } from '../vynuesStore';
import { RecurrenceBadge } from '../recurrence';
import NavBar from '../components/NavBar';
import RecurringDates from '../components/RecurringDates';
import { routineIsArchived } from '../lib/archive';
import { isGeneralTask } from '../domain/taskState';
import { lazyChunk } from '../lib/lazyChunk';
// The two drawers are the heaviest thing on this page and neither is on screen
// until the user asks for one — so they load on demand rather than sitting in
// the chunk that has to arrive before anything renders.
const TaskCreateDrawer = lazyChunk(() => import('../components/TaskCreateDrawer'));
const TaskEditDrawer = lazyChunk(() => import('../components/TaskEditDrawer'));
const QuestCreateDrawer = lazyChunk(() => import('../components/QuestCreateDrawer'));
// `import type`, not `import { type ... }`: under verbatimModuleSyntax the latter
// still emits the import statement, which pins the module into this chunk and
// silently undoes the lazy() above.
import type { EditTarget } from '../components/TaskEditDrawer';
import type { SubNode, SubtaskTreeHandlers } from '../components/SubtaskTree';
import { categoryColor, cleanQuest, routineSubNodes, vynuesSubNodes, hasCheckpoints, ANCHOR_CATEGORY } from '../lib/ui';
import Heatmap from '../components/Heatmap';
import FirstRunCard from '../components/FirstRunCard';
import TaskRow, { type RowStrip, type SystemMenu } from '../components/today/TaskRow';
import { useReorder } from '../components/today/useReorder';
import { Caption, DueLabel, VynuesDueLabel } from '../components/today/labels';
import { DaySwitcher, PondProgress } from '../components/today/chrome';
import PageBanner from '../components/PageBanner';
import Icon from '../components/Icon';
import { questArtwork } from '../lib/questArtwork';
import { questlineArt, withQuestCompleteToast } from '../lib/questComplete';
import { isDayClosed } from '../lib/dayClosed';
import './todayAgenda.css';
import './todayPondside.css';

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
  /** Art tile shared by every row filed here (a questline's picture). */
  art?: string;
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
const GENERAL_CATEGORY: Category = { key: 'general', label: 'General', color: 'var(--ink-dim)', rank: 2, kind: 'other' };
const VYNUES_KEY = 'vynues';

/** A routine that belongs to a system files under it, so the day's list shows
 *  which process each action is part of rather than a flat pile of habits. */
const systemCategory = (sys: System): Category =>
  ({ key: sys.id, label: sys.title, color: 'var(--water)', icon: sys.icon || '⚙️', rank: 1, kind: 'system' });

/** Every quest-derived row (a routine filed under a questline, a loose action, a
 *  pinned quest) files under its questline — same key, so they group together. */
const questlineCategory = (ql: Questline): Category =>
  ({ key: ql.id, label: ql.title, color: categoryColor(ql.color), rank: 3, kind: 'quest', art: questlineArt(ql) });

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
  /** This counter counts days rather than taps — see `sessionMode`. */
  sessionGoal?: boolean;
  /** Day strip / checkpoint ladder drawn under this row, where it applies. */
  strip?: RowStrip;
  subtasks?: SubNode[];
  subHandlers?: SubtaskTreeHandlers;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onUnpin?: () => void;
  /** Opens the full edit drawer for this task. */
  editTarget?: EditTarget;
  editQuest?: { questlineId: string; quest: Quest };
  /** Tag-click menu for reassigning this row's system. Routines only — quest
   *  actions and Vynues tasks have no system to belong to. */
  systemMenu?: SystemMenu;
}

function AgendaDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input:not([type]), input[type="text"]')?.focus();
    return () => { dialog.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className="inline-drawer" aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}

export default function Today() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const hiddenRows = useUIStore(s => s.hiddenAgendaRows);
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
  const [kind, setKind] = useState<'all' | 'system' | 'quest'>('all');
  const [showSkipped, setShowSkipped] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState('');
  const [drawerSystem, setDrawerSystem] = useState('');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editQuest, setEditQuest] = useState<{ questlineId: string; quest: Quest } | null>(null);

  const dragTodo = useReorder(reorderTodo);

  const byOrder = <T extends { order?: number }>(arr: T[]) =>
    arr.map((r, i) => ({ r, i })).sort((a, b) => (a.r.order ?? a.i) - (b.r.order ?? b.i)).map(x => x.r);

  // ── Day selector: today, or a live preview of tomorrow ─────────────────────
  const [preview, setPreview] = useState(false);
  const todayKey  = logicalDateKey();
  const viewStart = logicalDayStart();
  if (preview) viewStart.setDate(viewStart.getDate() + 1);
  const viewKey   = preview ? dateKey(viewStart) : todayKey;
  const viewProbe = atResetTime(viewStart);
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
    sessionGoal: sessionMode(r),
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
    if (repeats(r) && isGeneralTask(r)) bits.push(<RecurringDates key="dates" task={{ ...r, completed: willReset(r) ? false : r.completed }} now={atResetTime(new Date(`${viewKey}T12:00:00`))} />);
    if (!repeats(r) && r.dueDate) bits.push(<DueLabel key="due" dueDate={r.dueDate} todayKey={viewKey} />);
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
  const onToday = byOrder(routines.filter(r => !routineIsArchived(r, questlines, systems) && showsOnDay(r, viewKey, viewStart)));
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
      .find((s): s is System => !!s && !s.hidden);
    if (sys) return systemCategory(sys);
    const ql = r.questlineId ? questlines.find(q => q.id === r.questlineId) : undefined;
    return ql ? questlineCategory(ql) : GENERAL_CATEGORY;
  };

  // Due or undated pinned quests surface as one item with their action steps.
  const pinnedQuests = questlines.filter(ql => !ql.hidden).flatMap(ql =>
    ql.quests
      .filter(q => questShowsOnDay(q, viewKey))
      .map(quest => ({ quest, ql }))
  );

  const questActions = questlines.filter(ql => !ql.hidden).flatMap(ql =>
    ql.quests.flatMap(q =>
      // A quest pinned as a unit owns its actions on Today (they show nested under
      // it), so they must not also appear as standalone rows.
      q.hidden || !dueDateMatchesDay(q, viewKey) || questShowsOnDay(q, viewKey)
        ? []
        : q.actions
            .filter(a => actionShowsOnDay(a, viewStart))
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
        accentHex: fullyDone || todayDone ? 'var(--water)' : cat.color,
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
        accentHex: done ? 'var(--water)' : categoryColor(ql.color),
        meta: <RecurrenceBadge recurring={action.recurring} intervalDays={action.intervalDays} monthlyRule={action.monthlyRule} />,
        onToggle: () => { if (!preview) withQuestCompleteToast(ql.id, quest.id, () => toggleAction(ql.id, quest.id, action.id)); },
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
        editQuest: { questlineId: ql.id, quest },
        category: cat,
        completed: done,
        todayDone: false,
        streak: quest.streak,
        accentHex: done ? 'var(--water)' : cat.color,
        meta: <>{repeats(quest)
          ? <RecurrenceBadge recurring={quest.recurring} intervalDays={quest.intervalDays} monthlyRule={quest.monthlyRule} />
          : at > 0
            ? <Caption>Quest · {ad}/{at} tasks</Caption>
            : <Caption>Quest</Caption>}{quest.dueDate && !done && <> · <DueLabel dueDate={quest.dueDate} todayKey={viewKey} /></>}</>,
        subtasks: actionSubNodes(quest.actions, reset),
        subHandlers: {
          onAdd: (t: string) => addAction(ql.id, quest.id, t),
          onToggle: preview ? undefined : (aId: string) => withQuestCompleteToast(ql.id, quest.id, () => toggleAction(ql.id, quest.id, aId)),
          onRename: (aId: string, t: string) => updateActionTitle(ql.id, quest.id, aId, t),
          onDelete: (aId: string) => deleteAction(ql.id, quest.id, aId),
        } as SubtaskTreeHandlers,
        // The parent checkbox completes (or reopens) the whole quest at once.
        onToggle: () => { if (!preview) withQuestCompleteToast(ql.id, quest.id, () => setQuestComplete(ql.id, quest.id, !isQuestComplete(quest))); },
        onRename: (t: string) => updateQuestTitle(ql.id, quest.id, t),
        // ✕ on a pinned quest unpins it from Today rather than deleting the quest.
        onDelete: () => toggleQuestTracked(ql.id, quest.id),
        onUnpin: () => toggleQuestTracked(ql.id, quest.id),
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
        accentHex: done ? 'var(--water)' : categoryColor(project.color),
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
  const removedIds = hiddenRows?.day === viewKey ? hiddenRows.ids : [];
  const isListed = (it: TodoItem) => !removedIds.includes(it.id);
  const listedItems = todoItems.filter(isListed);
  const shownItems = listedItems.filter(it => showSkipped || !it.skipped);

  const kindCounts = {
    system: shownItems.filter(it => it.category.kind === 'system').length,
    quest: shownItems.filter(it => it.category.kind === 'quest').length,
  };

  const activeKind = kind !== 'all' && kindCounts[kind] > 0 ? kind : 'all';
  const kindItems = activeKind === 'all' ? shownItems : shownItems.filter(it => it.category.kind === activeKind);

  const categories = [...new Map(kindItems.map(it => [it.category.key, it.category]))
    .values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));

  const activeExists = filter === 'all' || categories.some(c => c.key === filter);
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
  const dragEnabled = !preview && activeKind === 'all' && (filter === 'all' || !activeExists);
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

  function renderRow(it: TodoItem, placement: 'open' | 'done' | 'habit') {
    const draggable = placement === 'open' && dragEnabled;
    return (
      <TaskRow
        key={it.id}
        inline={{
          expanded: expandedId === it.id,
          toggle: () => setExpandedId(current => current === it.id ? null : it.id),
          onRemove: () => {
            const active = document.activeElement;
            const row = active?.closest('.task-row');
            const neighbor = row?.nextElementSibling ?? row?.previousElementSibling;
            const focusTarget = neighbor?.querySelector<HTMLButtonElement>('.inline-title') ?? optionsButton.current;
            setExpandedId(null);
            useUIStore.setState(s => ({
              hiddenAgendaRows: { day: viewKey, ids: [...new Set([...(s.hiddenAgendaRows?.day === viewKey ? s.hiddenAgendaRows.ids : []), it.id])] },
            }));
            pushUndo(`Removed “${it.title}” from Today`, () => restoreRow(it.id));
            focusTarget?.focus();
          },
        }}
        compact={placement === 'habit'}
        title={it.title}
        tag={placement === 'habit' ? undefined : { label: it.category.tagLabel ?? it.category.label, color: it.category.color }}
        systemMenu={it.systemMenu}
        completed={it.completed}
        todayDone={it.todayDone}
        skipped={it.skipped}
        streak={it.streak}
        accentHex={placement === 'done' ? 'var(--water)' : it.accentHex}
        art={it.category.art ?? questArtwork(it.title, it.id, it.category.label)}
        sourceLine={it.meta}
        onToggle={it.onToggle}
        onSkip={placement === 'done' ? undefined : it.onSkip}
        onUnpin={it.onUnpin}
        onDelete={placement === 'done' || preview ? undefined : it.onDelete}
        onRename={it.onRename}
        onEdit={it.editQuest ? () => setEditQuest(it.editQuest!) : it.editTarget ? () => setEditTarget(it.editTarget!) : undefined}
        drag={draggable ? {
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
        sessionGoal={it.sessionGoal}
        strip={it.strip}
        readOnly={preview}
        subtasks={it.subtasks}
        subHandlers={it.subHandlers}
      />
    );
  }

  const allHabits = anchorRoutines.map(routineItem);
  const anchorItems = activeTasksFirst(allHabits.filter(isListed));
  const removedItems = [...todoItems, ...allHabits].filter(it => !isListed(it));
  const skippedCount = listedItems.filter(it => it.skipped).length;
  const dayItems = [...listedItems, ...anchorItems].filter(it => !it.skipped);
  const done = dayItems.filter(settledOf).length;
  const hasFilters = kindCounts.system > 0 || kindCounts.quest > 0 || categories.length > 1 || skippedCount > 0 || showSkipped;
  const isFresh = !questlines.length && !routines.length && !vynuesProjects.length;
  const dayName = preview ? 'Tomorrow' : 'Today';
  const dayClosed = isDayClosed(done, dayItems.length, preview);
  // Chip counts describe open work, the same number the list below shows.
  const openIn = (key: string) => kindItems.filter(it => !settledOf(it) && (key === 'all' || it.category.key === key)).length;

  function restoreRow(id: string) {
    useUIStore.setState(s => s.hiddenAgendaRows?.day === viewKey
      ? { hiddenAgendaRows: { day: viewKey, ids: s.hiddenAgendaRows.ids.filter(item => item !== id) } }
      : s);
  }

  function openDrawer() {
    const key = categories.find(c => c.key === filter)?.key;
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

  function openHabitDrawer() {
    setDrawerCategory(ANCHOR_CATEGORY);
    setDrawerSystem('');
    setDrawerOpen(true);
  }

  function changeDay(next: boolean) {
    if (next === preview) return;
    setPreview(next);
    setFilter('all');
    setKind('all');
    setShowSkipped(false);
    setExpandedId(null);
  }

  const dateHeading = viewStart.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const rows = orderedTodoOpen.map(it => renderRow(it, 'open'));
  const drawers = <>
    {drawerOpen && <TaskCreateDrawer open initialCategory={drawerCategory} initialSystem={drawerSystem} initialDueDate={preview ? viewKey : ''} onClose={() => setDrawerOpen(false)} />}
    {editTarget && <TaskEditDrawer target={editTarget} onClose={() => setEditTarget(null)} />}
    {editQuest && <QuestCreateDrawer open editing={editQuest} onClose={() => setEditQuest(null)} />}
  </>;

  return (
    <div className="page-shell agenda-page agenda-inline">
      <NavBar hideCover />
      <main className="agenda">
        <PageBanner pathname="/" date={{
          key: viewKey, long: dateHeading,
          short: viewStart.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
        }} />

        <div className="agenda-layout">
          <section className="agenda-list" aria-labelledby="agenda-tasks">
            <div className="agenda-section-head">
              <h1 id="agenda-tasks">{dayName}</h1>
              <button type="button" className="btn-gold agenda-new" onClick={openDrawer}>
                <span aria-hidden="true">+</span> New task
              </button>
              <button ref={optionsButton} type="button" className="inline-options icon-btn-round" aria-label="List options" title="List options"
                aria-controls="agenda-options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(v => !v)}><Icon name="more" /></button>
            </div>
            <PondProgress done={done} total={dayItems.length} dayKey={viewKey} preview={preview} />
            {categories.length > 1 && (
              <div className="pond-chips" role="group" aria-label="Filter by category">
                <button type="button" className="chip" aria-pressed={filter === 'all' || !activeExists} onClick={() => setFilter('all')}>
                  All <span className="chip-count">{openIn('all')}</span>
                </button>
                {categories.map(c => (
                  <button type="button" className="chip" key={c.key} aria-pressed={activeExists && filter === c.key} onClick={() => setFilter(c.key)}>
                    {c.label} <span className="chip-count">{openIn(c.key)}</span>
                  </button>
                ))}
              </div>
            )}
            <div id="agenda-options" hidden={!optionsOpen}
              onKeyDown={e => { if (e.key === 'Escape') { setOptionsOpen(false); optionsButton.current?.focus(); } }}>
            <div className="inline-day"><DaySwitcher preview={preview} onChange={changeDay} /></div>
            {hasFilters && (
              <div className="agenda-filters" role="group" aria-label="Task filters">
                {(['all', 'system', 'quest'] as const).map(k =>
                  (k === 'all' || kindCounts[k] > 0) && (
                    <button type="button" className="agenda-filter" key={k}
                      aria-pressed={activeKind === k}
                      onClick={() => { setKind(k); setFilter('all'); }}>
                      {{ all: 'All', system: 'Systems', quest: 'Quests' }[k]}
                    </button>
                  )
                )}
                {(skippedCount > 0 || showSkipped) && (
                  <button type="button" className="agenda-filter agenda-skipped" aria-pressed={showSkipped}
                    onClick={() => setShowSkipped(!showSkipped)}>
                    {showSkipped ? 'Hide skipped' : 'Show skipped'} · {skippedCount}
                  </button>
                )}
              </div>
            )}
            {removedItems.length > 0 && <div className="inline-removed"><h2>Removed from today</h2>
              {removedItems.map(it => <button type="button" className="inline-text" key={it.id} onClick={() => restoreRow(it.id)}>Restore {it.title}</button>)}
            </div>}
            </div>

            {dragEnabled ? (
              <Reorder.Group as="div" axis="y" className="agenda-rows" values={orderedIds} onReorder={dragTodo.onReorder}>
                <AnimatePresence initial={false}>{rows}</AnimatePresence>
              </Reorder.Group>
            ) : <div className="agenda-rows">{rows}</div>}

            {todoOpen.length === 0 && (
              isFresh && !preview ? <FirstRunCard /> : (
                <p className="agenda-empty">
                  {todoDone.length ? 'All tasks in this list are complete.' :
                    skippedCount > 0 && !showSkipped ? 'No open tasks. Skipped tasks are hidden.' :
                    `No tasks scheduled for ${dayName.toLowerCase()}.`}
                </p>
              )
            )}
            {todoDone.length > 0 && (
              <details className="agenda-completed">
                <summary>Completed <span className="agenda-count">{todoDone.length}</span></summary>
                <div className="agenda-rows">{todoDone.map(it => renderRow(it, 'done'))}</div>
              </details>
            )}
          </section>

          <aside className="agenda-side" aria-label="Habits and progress">
            <section className="agenda-habits" aria-labelledby="agenda-habits-title">
              <header className="agenda-habits-head">
                <h2 id="agenda-habits-title">Daily habits</h2>
              </header>
              <div className="agenda-habit-body">
                {anchorItems.length > 0
                  ? anchorItems.map(it => renderRow(it, 'habit'))
                  : <p className="agenda-habits-empty">No habits scheduled.</p>}
                {!preview && <button type="button" className="agenda-text-action" onClick={openHabitDrawer}>
                  + Add habit
                </button>}
              </div>
            </section>
            <section className="pond-panel" aria-labelledby="agenda-heat-title">
              <h2 id="agenda-heat-title">Last 12 weeks</h2>
              <Heatmap weeks={12} compact closedToday={dayClosed} />
            </section>
          </aside>
        </div>
        <details className="agenda-history">
          <summary>Activity history</summary>
          <Heatmap />
        </details>
      </main>

      {/* No fallback: a drawer slides in over the page, so an empty frame for the
          moment it takes to arrive is exactly the right thing to show. */}
      <Suspense fallback={null}>
        {(drawerOpen || editTarget || editQuest) ?
          <AgendaDialog label={drawerOpen ? (drawerCategory === ANCHOR_CATEGORY ? 'New habit' : 'New task') : 'Edit task'}
            onClose={() => { setDrawerOpen(false); setEditTarget(null); setEditQuest(null); }}>{drawers}</AgendaDialog> : drawers}
      </Suspense>
    </div>
  );
}
