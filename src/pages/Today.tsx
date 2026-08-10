import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, Reorder, useDragControls, type PanInfo } from 'framer-motion';
import type { Routine, Schedule, Action, Questline } from '../types';
import {
  useQuestStore, logicalDateKey, logicalDayStart, dateKey, dueOnDay, periodExpired, skipActive,
  isMultiDayCycle, isGoalRoutine, engagedOnDay, subtaskStats, repeats, isQuestComplete, questProgress, DAY_RESET_HOUR,
} from '../store';
import { useVynuesStore, getTaskDueInfo, vynuesCategoryKey } from '../vynuesStore';
import type { VynuesTask } from '../vynuesStore';
import { RecurrenceBadge } from '../recurrence';
import NavBar from '../components/NavBar';
import TaskCreateDrawer, { ANCHOR_CATEGORY } from '../components/TaskCreateDrawer';
import TaskEditDrawer, { type EditTarget } from '../components/TaskEditDrawer';
import SubtaskTree, { type SubNode, type SubtaskTreeHandlers } from '../components/SubtaskTree';
import { categoryColor, cleanQuest, routineSubNodes, vynuesSubNodes, countSubNodes } from '../lib/ui';
import Heatmap from '../components/Heatmap';
import IconButton from '../components/IconButton';

/** A quest's visible actions mapped into Today check-off steps. `forceOpen`
 *  renders them unchecked (tomorrow preview of a quest that will have reset). */
function actionSubNodes(actions: Action[], forceOpen: boolean): SubNode[] {
  return actions.filter(a => !a.hidden).map(a => ({ id: a.id, title: a.title, done: forceOpen ? false : a.completed }));
}

/** Decides whether a routine belongs on the given logical day's list. `dayKey` is a
 *  'YYYY-MM-DD' key and `dayStart` is that day's midnight — they travel together so
 *  the tomorrow preview can ask the same question about the next day.
 *  - Daily tasks always surface.
 *  - Multi-day *goals* (weekly "gym 3×" counters, or weekly tasks with steps) surface
 *    every day while open — they're built to be chipped away at — and, once fully
 *    complete, linger only through the day they were finished.
 *  - Other weekly / monthly / interval tasks surface on the day their period ends
 *    (or when pinned) — that list is for work due *that day*.
 *  - A one-off surfaces from its due date on; a completed one lingers only through
 *    its completion day. */
function showsOnDay(r: Routine, dayKey: string, dayStart: Date): boolean {
  if (repeats(r)) {
    if (r.recurring === 'daily' && !r.intervalDays && !r.monthlyRule) return true;
    if (isGoalRoutine(r)) {
      if (r.completed) return !!r.completedAt && logicalDateKey(new Date(r.completedAt)) === dayKey;
      return true;
    }
    return !!r.trackedToday || dueOnDay(r, dayStart);
  }
  if (r.dueDate && r.dueDate > dayKey) return false;
  if (r.completed) return !!r.completedAt && logicalDateKey(new Date(r.completedAt)) === dayKey;
  return true;
}

/** The Vynues equivalent of `showsOnDay`. */
function vynuesShowsOnDay(t: VynuesTask, dayKey: string, dayStart: Date): boolean {
  if (repeats(t)) {
    if (t.recurring === 'daily' && !t.intervalDays && !t.monthlyRule) return true;
    return !!t.tracked || dueOnDay(t, dayStart);
  }
  const due = t.tracked || (!!t.dueDate && t.dueDate.slice(0, 10) <= dayKey);
  if (!due) return false;
  if (t.done) return !!t.completedAt && logicalDateKey(new Date(t.completedAt)) === dayKey;
  return true;
}

/** The small caption under a row's title — due dates, "3/5 this cycle", and the
 *  like. One style, so they all sit on the same line consistently. */
const Caption = ({ color = 'var(--page-text-dim)', children }: { color?: string; children: React.ReactNode }) =>
  <span style={{ fontSize: 11, fontWeight: 600, color }}>{children}</span>;

/** Compact due-date pill for a one-time To-Do row. */
function DueLabel({ dueDate, todayKey }: { dueDate: string; todayKey: string }) {
  const overdue = dueDate < todayKey;
  const today = dueDate === todayKey;
  const text = overdue ? 'Overdue' : today ? 'Due today'
    : `Due ${new Date(`${dueDate}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  return <Caption color={overdue ? 'var(--danger)' : today ? 'var(--accent)' : 'var(--text-dim)'}>{text}</Caption>;
}

/** Due pill for a Vynues task, whose due dates can carry a time of day. */
function VynuesDueLabel({ dueDate }: { dueDate: string }) {
  const { text, urgency } = getTaskDueInfo(dueDate);
  return (
    <Caption color={urgency === 'overdue' ? 'var(--danger)' : urgency === 'urgent' ? 'var(--accent)' : 'var(--text-dim)'}>
      {text}
    </Caption>
  );
}

// ── Today progress summary ────────────────────────────────────────────────────

function ProgressSummary({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = total > 0 && done === total;
  return (
    <div className="parchment glass-card" style={{ borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: allDone ? 'var(--success)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {done}/{total} {allDone ? '· all done ✦' : 'done'}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--track-bg)', borderRadius: 999, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className={allDone ? 'bar-fill bar-fill-done' : 'bar-fill'}
          style={{ height: '100%', borderRadius: 999 }}
        />
      </div>
      {total === 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
          Add tasks below to start tracking your day.
        </p>
      )}
    </div>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────

interface DragHandlers {
  /** This row's identity for framer-motion's `Reorder.Group`. */
  value: string;
  onDragStart: () => void;
  onDrag: (e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => void;
  onDragEnd: () => void;
}

/** Scrolls the window while a reorder-drag is active and the pointer sits near
 *  the top or bottom edge of the *viewport*, so a long list can be reordered
 *  without first scrolling by hand to make room for the drop target: hold the
 *  row against an edge and the page comes to you. Speed eases in quadratically
 *  across the band — a slow creep where the band starts, topping out only once
 *  the pointer is hard against (or past) the screen edge — and is expressed in
 *  px/second against the real frame delta, so it feels the same on a 60Hz and a
 *  144Hz display.
 *
 *  Fed by the pointer position `Reorder.Item`'s `onDrag` reports — there's no
 *  native drag event to listen for the way HTML5 DnD has one. That position is
 *  in *page* coordinates (framer reads `pageX`/`pageY`), so `report` takes the
 *  scroll offset back off before the loop compares it to the viewport edges.
 *  Skipping that conversion is what made this run away: once the page was
 *  scrolled at all, page-Y was past `innerHeight` almost everywhere, every
 *  position read as "below the bottom edge", and the un-clamped ramp beyond the
 *  band squared it into a jump straight to the end of the list. */
function useDragAutoScroll(active: boolean) {
  // null until this drag reports its first position — an unseeded 0 would read
  // as "pointer pinned to the top of the screen" and yank the page up on grab.
  const pointerYRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const MIN_SPEED = 90, MAX_SPEED = 1000; // px/s entering the band / at the edge
    let previous = performance.now();
    let carry = 0; // sub-pixel remainder — scrollBy can't move less than a pixel
    let raf = requestAnimationFrame(function tick(now) {
      raf = requestAnimationFrame(tick);
      // Clamp the delta so one stalled frame (GC pause, window restore) spends
      // its backlog at ~50ms of travel instead of teleporting the page.
      const dt = Math.min(now - previous, 50) / 1000;
      previous = now;
      const y = pointerYRef.current;
      if (y === null) return;
      // Band scales with the window, bounded so it stays easy to hit on a short
      // one without swallowing a third of a tall one.
      const vh = window.innerHeight;
      const edge = Math.min(180, Math.max(90, vh * 0.2));
      const past = y < edge ? edge - y : y > vh - edge ? y - (vh - edge) : 0;
      if (!past) { carry = 0; return; }
      // Dragging past the screen edge is just full speed, never more.
      const t = Math.min(1, past / edge);
      const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * t * t;
      const step = carry + (y < edge ? -speed : speed) * dt;
      const whole = Math.trunc(step);
      carry = step - whole;
      if (whole) window.scrollBy(0, whole);
    });
    return () => { cancelAnimationFrame(raf); pointerYRef.current = null; };
  }, [active]);
  /** Feed the loop the pointer's latest page Y. */
  return useCallback((pageY: number) => { pointerYRef.current = pageY - window.scrollY; }, []);
}

/** Drag-to-reorder state for the To-Do list, built on framer-motion's `Reorder`
 *  primitives: the dragged row follows the pointer directly and its neighbours
 *  slide out of the way immediately, rather than the row staying put next to a
 *  separate gap marker. The live order lives in local state while dragging and
 *  is only written to the store once, on release — so a mid-drag reflow (a
 *  recurring task resetting, say) can't yank the list out from under a finger. */
function useReorder(reorder: (ids: string[]) => void) {
  const [dragging, setDragging] = useState(false);
  const [liveOrder, setLiveOrderState] = useState<string[] | null>(null);
  const liveOrderRef = useRef<string[] | null>(null);
  const reportPointerY = useDragAutoScroll(dragging);

  // Dragging across text otherwise leaves a trail of blue selection highlight
  // over every row the cursor crosses, which reads as the UI glitching.
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('reordering');
    return () => document.body.classList.remove('reordering');
  }, [dragging]);

  const setLiveOrder = (v: string[] | null) => { liveOrderRef.current = v; setLiveOrderState(v); };

  return {
    dragging,
    /** The order to render right now: the live in-progress order while dragging,
     *  else whatever the caller's own sort produces. */
    orderOf: (baseIds: string[]) => liveOrder ?? baseIds,
    onReorder: setLiveOrder,
    onDragStart: () => setDragging(true),
    onDrag: (_e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => reportPointerY(info.point.y),
    onDragEnd: () => {
      setDragging(false);
      if (liveOrderRef.current) reorder(liveOrderRef.current);
      setLiveOrder(null);
    },
  };
}

/** Counter control that replaces the checkbox for counter tasks: −  2/3 oz  ＋,
 *  with a slim progress bar. The task completes once progress reaches target. */
function CounterControl({ progress, target, step = 1, unit, complete, accentHex, onIncrement, readOnly = false }: {
  progress: number; target: number; step?: number; unit?: string;
  complete: boolean; accentHex: string; onIncrement: (delta: number) => void;
  readOnly?: boolean;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const color = complete ? 'var(--success)' : accentHex;
  const stepBtn = (label: string, delta: number, blocked: boolean) => {
    const disabled = readOnly || blocked;
    return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onIncrement(delta); }}
      disabled={disabled}
      title={delta > 0 ? `+${step}` : `−${step}`}
      className="counter-btn"
      style={{
        width: 23, height: 23, borderRadius: 7, flexShrink: 0,
        border: '1px solid var(--page-border)', background: 'var(--page-surface)',
        color: disabled ? 'var(--page-text-dim)' : 'var(--page-text)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        fontSize: 14, lineHeight: 1, fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.15s, color 0.15s, transform 0.1s',
      }}
    >
      {label}
    </button>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, minWidth: 104, alignSelf: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {stepBtn('−', -step, progress <= 0)}
        <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {progress}/{target}{unit ? ` ${unit}` : ''}
        </span>
        {stepBtn('＋', step, complete)}
      </div>
      <div style={{ height: 3.5, background: 'var(--track-bg)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.3s cubic-bezier(.22,1,.36,1)' }} />
      </div>
    </div>
  );
}

/** Skip-forward glyph (⏭) — marks a task skipped for today. */
function SkipIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M4 5.5a1 1 0 0 1 1.55-.83l8.2 5.5a1 1 0 0 1 0 1.66l-8.2 5.5A1 1 0 0 1 4 16.5v-11Z" />
      <path d="M16.5 5a1 1 0 0 1 1 1v12a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

const SKIP_COLOR = '#fbbf24';

/** Controls inside a task row that must keep working as controls — a pointer-down
 *  on one of these starts a click, not a drag. */
const INTERACTIVE_SEL = 'button, input, textarea, select, a, label, [contenteditable]';


interface TaskRowProps {
  title: string;
  /** The whole task is finished (weekly goal hit 3/3, checkbox ticked…). */
  completed: boolean;
  /** Today's share of a multi-day goal is done (a session was logged) even though
   *  the goal itself is still open — renders the teal "done for today" state. */
  todayDone?: boolean;
  skipped?: boolean;
  onSkip?: () => void;
  streak?: number;
  accentHex: string;
  sourceLine?: React.ReactNode;
  tag?: { label: string; color: string };
  onToggle: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
  /** Opens the full edit panel (due date, schedule, category, steps — everything). */
  onEdit?: () => void;
  drag?: DragHandlers;
  subtasks?: SubNode[];
  subHandlers?: SubtaskTreeHandlers;
  target?: number;
  progress?: number;
  step?: number;
  unit?: string;
  onIncrement?: (delta: number) => void;
  readOnly?: boolean;
}

function TaskRow({
  title, completed, todayDone = false, skipped, onSkip, streak, accentHex, sourceLine, tag, onToggle, onDelete, onRename, onEdit, drag,
  subtasks, subHandlers,
  target, progress, step, unit, onIncrement, readOnly = false,
}: TaskRowProps) {
  const [hovered, setHovered] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  // Always called (rules of hooks) but only wired up when `drag` is present —
  // it's what lets the grip start the row's drag without the whole row being
  // a drag source (so the checkbox, buttons, etc. stay clickable).
  const dragControls = useDragControls();

  // Inline rename — double-click the title. The ✎ pencil opens the full editor.
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const editRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  function startEdit() {
    if (!onRename) return;
    setTitleDraft(title);
    setEditing(true);
  }
  function commitEdit() {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; return; }
    const t = titleDraft.trim();
    if (t && t !== title) onRename?.(t);
  }

  const subtasksEnabled = !!subHandlers?.onAdd;
  const subs = subtasks ?? [];
  const subCount = countSubNodes(subs);
  const isCounter = target != null && !!onIncrement;

  const edgeColor = completed ? 'var(--success)' : todayDone ? 'var(--success)' : skipped ? SKIP_COLOR : accentHex;

  const rowStyle: React.CSSProperties = {
    // `position: relative` is what lets the lifted row's z-index actually raise it
    // above its neighbours while it's being dragged over them.
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    padding: '13px 16px',
    // Draggable rows are spaced by the group's `gap` instead: framer measures
    // bounding boxes, which exclude margin, so a margin would leave an unmeasured
    // dead band between rows and make the crossover points feel imprecise.
    ...(drag ? {} : { marginBottom: 8 }),
    background: hovered && !completed && !skipped ? 'var(--page-surface-hover)' : 'var(--page-surface)',
    border: '1px solid var(--page-border)',
    borderLeft: `3px solid ${edgeColor}`,
    borderRadius: 12,
    // NB: `transform` must stay out of this CSS transition on a draggable row —
    // framer drives the drag and the reorder shuffle through transform, and a CSS
    // ease layered on top makes the row lag behind the cursor instead of tracking it.
    transition: drag
      ? 'background 0.15s, border-color 0.12s, border-left-color 0.3s'
      : 'background 0.15s, border-color 0.12s, border-left-color 0.3s, box-shadow 0.2s, transform 0.2s',
    boxShadow: hovered && !completed && !skipped ? 'var(--row-shadow-hover)' : 'var(--row-shadow)',
    cursor: drag ? 'grab' : undefined,
  };

  // Grabbing the row anywhere drags it — the way reorderable lists behave
  // elsewhere — while clicks on the controls inside it still do their own thing.
  function startRowDrag(e: React.PointerEvent) {
    if (!drag || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SEL)) return;
    dragControls.start(e);
  }

  const rowContent = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {drag && (
          <span
            // The row itself is draggable; this stays as the visual affordance
            // (and the touch target, where `touch-action` has to be suppressed).
            onPointerDown={e => dragControls.start(e)}
            title="Drag to reorder"
            style={{
              flexShrink: 0, color: 'var(--text-dim)', fontSize: 16, lineHeight: 1,
              cursor: 'grab', userSelect: 'none', touchAction: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 28, borderRadius: 6,
              opacity: hovered ? 0.85 : 0.45, transition: 'opacity 0.15s',
            }}
          >
            ⠿
          </span>
        )}
        {isCounter ? (
          <CounterControl
            progress={progress ?? 0}
            target={target!}
            step={step}
            unit={unit}
            complete={completed || (progress ?? 0) >= target!}
            accentHex={todayDone ? 'var(--success)' : accentHex}
            onIncrement={onIncrement!}
            readOnly={readOnly}
          />
        ) : (
          <input
            type="checkbox"
            className="rune-check"
            checked={completed}
            onChange={onToggle}
            disabled={readOnly}
            title={readOnly ? 'Come back tomorrow to check this off' : subCount.total > 0 ? 'Completes every step too' : undefined}
            style={{ flexShrink: 0, marginTop: sourceLine ? 2 : 0, ...(readOnly ? { cursor: 'default', opacity: 0.6 } : {}) }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              ref={editRef}
              autoFocus
              className="rune-input"
              value={titleDraft}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setTitleDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') editRef.current?.blur();
                if (e.key === 'Escape') { cancelRef.current = true; editRef.current?.blur(); }
              }}
              onBlur={commitEdit}
              style={{ width: '100%', fontSize: 14, fontWeight: 500, padding: '4px 8px' }}
            />
          ) : (
            <span
              onDoubleClick={startEdit}
              title={onRename ? 'Double-click to rename' : undefined}
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 500,
                color: completed || skipped ? 'var(--page-text-dim)' : 'var(--page-text)',
                textDecoration: completed ? 'line-through' : 'none',
                lineHeight: 1.4,
                cursor: onRename ? 'text' : undefined,
              }}
            >
              {tag && (
                <>
                  <span style={{ fontWeight: 700, color: tag.color }}>{tag.label}</span>
                  <span style={{ color: 'var(--page-text-dim)', opacity: 0.7 }}> — </span>
                </>
              )}
              {title}
              {todayDone && !completed && (
                <span className="pill-today-done">✓ TODAY</span>
              )}
              {skipped && (
                <span style={{
                  marginLeft: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                  color: SKIP_COLOR, border: `1px solid ${SKIP_COLOR}`,
                  padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap',
                }}>
                  SKIPPED
                </span>
              )}
              {subCount.total > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: subCount.done === subCount.total ? 'var(--success)' : 'var(--page-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                  {subCount.done}/{subCount.total}
                </span>
              )}
            </span>
          )}
          {sourceLine && (
            <span style={{ display: 'block', marginTop: 4 }}>
              {sourceLine}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, marginTop: 2 }}>
          {(streak ?? 0) > 1 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316' }}>
              🔥{streak}
            </span>
          )}
          {/* Skip — stays visible while skipped so it can be undone. */}
          {onSkip && !completed && (hovered || skipped) && (
            <IconButton
              onClick={onSkip}
              title={skipped
                ? 'Skipped today — click to un-skip'
                : "Skip just today — streak safe, back tomorrow. A weekly goal keeps its progress."}
              rest={skipped ? SKIP_COLOR : undefined}
              hover={SKIP_COLOR}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <SkipIcon />
            </IconButton>
          )}
          {subtasksEnabled && !completed && !skipped && (hovered || subs.length > 0) && (
            <IconButton onClick={() => setAddingSub(v => !v)} title="Add a step" size={15}>
              ＋
            </IconButton>
          )}
          {onEdit && (hovered || editing) && (
            <IconButton onClick={onEdit} title="Edit everything — name, due date, schedule, steps…" size={12}>
              ✎
            </IconButton>
          )}
          {onDelete && hovered && !completed && (
            <IconButton onClick={onDelete} title="Delete" hover="var(--danger)" size={12}>
              ✕
            </IconButton>
          )}
        </div>
      </div>

      {/* Steps — infinitely nestable */}
      {(subs.length > 0 || addingSub) && subHandlers && (
        <div style={{ marginTop: 9, paddingLeft: drag ? 42 : 30 }}>
          <SubtaskTree
            nodes={subs}
            handlers={subHandlers}
            readOnly={readOnly}
            showRootAdd={addingSub}
            onDismissRootAdd={() => setAddingSub(false)}
          />
        </div>
      )}
    </>
  );

  const opacityTarget = completed ? 0.68 : skipped ? 0.55 : 1;
  const sharedMotionProps = {
    exit: { opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 },
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    className: 'task-row',
    style: rowStyle,
  };

  // A draggable row renders as a Reorder.Item, so it can follow the pointer and
  // slide its neighbours out of the way live; a non-draggable one (a filtered
  // view, or the "Done" group) stays a plain motion.div.
  if (drag) {
    return (
      <Reorder.Item
        as="div"
        value={drag.value}
        dragListener={false}
        dragControls={dragControls}
        onPointerDown={startRowDrag}
        // No rubber-banding and no post-release drift — the row should track the
        // pointer exactly and stop dead the instant it's released, not slide on.
        dragElastic={0}
        dragMomentum={false}
        // Only depth, never scale: framer decides where a row lands by measuring
        // bounding boxes, and scaling the one under the cursor moves the very
        // edges those crossover points are computed from — that reads as jitter.
        whileDrag={{ boxShadow: '0 14px 30px rgba(0,0,0,0.28)', zIndex: 5 }}
        onDragStart={drag.onDragStart}
        onDrag={drag.onDrag}
        onDragEnd={drag.onDragEnd}
        // Deliberately no `y` in initial/animate here. Drag and the reorder
        // shuffle both write the y transform, and a `y` animation target would be
        // re-applied on every re-render mid-drag (they fire constantly, on each
        // crossover) — snapping the held row back toward its origin under the cursor.
        initial={{ opacity: 0 }}
        animate={{ opacity: opacityTarget }}
        transition={{ duration: 0.22, layout: { type: 'spring', stiffness: 700, damping: 46 } }}
        {...sharedMotionProps}
      >
        {rowContent}
      </Reorder.Item>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: opacityTarget, y: 0 }}
      transition={{ duration: 0.22 }}
      {...sharedMotionProps}
    >
      {rowContent}
    </motion.div>
  );
}

/** The edge button that flips between today and the tomorrow preview. The two
 *  directions are the same button mirrored — side, arrow, nudge and label all
 *  follow from `forward`. */
function DayFlipper({ forward, onClick }: { forward: boolean; onClick: () => void }) {
  const sign = forward ? 1 : -1;
  return (
    <motion.button
      onClick={onClick}
      title={forward ? 'Peek at tomorrow — dailies reset, plan the next day' : 'Back to today'}
      initial={{ opacity: 0, x: sign * 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: sign * 24 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      className="day-flipper"
      style={{ position: 'fixed', [forward ? 'right' : 'left']: 16, top: '38%', zIndex: 30 }}
    >
      <motion.span
        animate={{ x: [0, sign * 5, 0] }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        style={{ display: 'block', fontSize: 20, lineHeight: 1 }}
      >
        {forward ? '→' : '←'}
      </motion.span>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em' }}>{forward ? 'TMRW' : 'TODAY'}</span>
    </motion.button>
  );
}

// ── Categories ────────────────────────────────────────────────────────────────

interface Category {
  key: string;
  label: string;
  color: string;
  icon?: string;
  tagLabel?: string;
  rank: number;
}

const CHUD_CATEGORY: Category    = { key: 'chud',    label: 'Fixing my Chud life', tagLabel: 'Chud life', color: 'var(--accent)', icon: '🛠️', rank: 0 };
const GENERAL_CATEGORY: Category = { key: 'general', label: 'General', color: 'var(--text-dim)', rank: 1 };
const VYNUES_KEY = 'vynues';

/** Every quest-derived row (a routine filed under a questline, a loose action, a
 *  pinned quest) files under its questline — same key, so they group together. */
const questlineCategory = (ql: Questline): Category =>
  ({ key: ql.id, label: ql.title, color: categoryColor(ql.color), rank: 2 });

/** One filter chip: category name, a colour dot, and how many are still open. */
function Chip({ label, icon, color, open, total, active, onClick }: {
  label: string; icon?: string; color?: string;
  open: number; total: number; active: boolean; onClick: () => void;
}) {
  const cleared = total > 0 && open === 0;
  return (
    <button type="button" className="chip" data-active={active} onClick={onClick}>
      {icon
        ? <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
        : color && <span className="chip-dot" style={{ background: color }} />}
      <span>{label}</span>
      <span className="chip-count" style={cleared ? { color: 'var(--success)' } : undefined}>
        {cleared ? '✓' : open}
      </span>
    </button>
  );
}

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
  subtasks?: SubNode[];
  subHandlers?: SubtaskTreeHandlers;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  /** Opens the full edit drawer for this task. */
  editTarget?: EditTarget;
}

export default function Today() {
  const questlines     = useQuestStore(s => s.questlines);
  const routines       = useQuestStore(s => s.routines);
  const deleteRoutine  = useQuestStore(s => s.deleteRoutine);
  const reorderTodo    = useQuestStore(s => s.reorderTodo);
  const todoOrder      = useQuestStore(s => s.todoOrder);
  const toggleRoutine  = useQuestStore(s => s.toggleRoutine);
  const skipRoutine    = useQuestStore(s => s.skipRoutine);
  const incrementRoutine = useQuestStore(s => s.incrementRoutine);
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState('');
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

  // Skips are day-scoped now: today's skip never spills into tomorrow, so the
  // preview simply shows everything unskipped.
  const skipOf = (r: Routine) => preview
    ? { skipped: false, onSkip: undefined }
    : { skipped: skipActive(r, todayKey), onSkip: () => skipRoutine(r.id) };

  // The recurrence badge / due pill / goal hint under a routine's title.
  const routineMeta = (r: Routine) => {
    const bits: React.ReactNode[] = [];
    if (repeats(r)) bits.push(<RecurrenceBadge key="rec" recurring={r.recurring} intervalDays={r.intervalDays} monthlyRule={r.monthlyRule} />);
    else if (r.dueDate) bits.push(<DueLabel key="due" dueDate={r.dueDate} todayKey={viewKey} />);
    if (!preview && isGoalRoutine(r) && !r.completed) {
      const stats = r.target != null
        ? { done: r.progress ?? 0, total: r.target }
        : subtaskStats(r.subtasks);
      bits.push(
        <Caption key="goal">{stats.done}/{stats.total} this cycle</Caption>
      );
    }
    if (!bits.length) return undefined;
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{bits}</span>;
  };

  // ── Sources ────────────────────────────────────────────────────────────────
  const liveRoutines = byOrder(routines.filter(r => !r.hidden && showsOnDay(r, viewKey, viewStart)));

  const categoryOfRoutine = (r: Routine): Category => {
    if (r.anchor) return CHUD_CATEGORY;
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
  const todoItems: TodoItem[] = [
    ...liveRoutines.map(r => {
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
        ...counterOf(r),
        ...skipOf(r),
        ...routineSubProps(r),
        onToggle: () => { if (!preview) toggleRoutine(r.id); },
        onRename: (t: string) => updateRoutineTitle(r.id, t),
        onDelete: () => deleteRoutine(r.id),
        editTarget: { kind: 'routine', id: r.id } as EditTarget,
      };
    }),
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
          color: categoryColor(project.color), icon: '🚩', rank: 3,
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
  const chips = [...todoItems
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
    ? todoItems
    : todoItems.filter(it => it.category.key === filter);

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

  const todoRows = orderedTodoOpen.map(it => (
    <TaskRow
      key={it.id}
      title={it.title}
      tag={{ label: it.category.tagLabel ?? it.category.label, color: it.category.color }}
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
      } : undefined}
      target={it.target}
      progress={it.progress}
      step={it.step}
      unit={it.unit}
      onIncrement={it.onIncrement}
      readOnly={preview}
      subtasks={it.subtasks}
      subHandlers={it.subHandlers}
    />
  ));

  const done  = todoDone.length;
  const total = visible.filter(it => !it.skipped).length;
  const activeChip = chips.find(c => c.category.key === filter);
  const progressLabel = activeChip ? activeChip.category.label : preview ? "Tomorrow's plan" : "Today's progress";

  function openDrawer() {
    const key = activeChip?.category.key;
    const firstProject = vynuesProjects.find(p => p.status === 'active');
    const preset =
      key === CHUD_CATEGORY.key           ? ANCHOR_CATEGORY :
      key === VYNUES_KEY                  ? (firstProject ? vynuesCategoryKey(firstProject.id) : '') :
      key && key !== GENERAL_CATEGORY.key ? key :
                                            '';
    setDrawerCategory(preset);
    setDrawerOpen(true);
  }

  const dateHeading = viewStart.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <NavBar />

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '28px 20px 60px', overflowX: 'hidden' }}>

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
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--page-text)', lineHeight: 1.55 }}>
              <strong>Tomorrow, previewed</strong> — dailies are shown already reset. Add, rename, reorder
              or delete to shape the day; checking off unlocks when it arrives.
            </p>
          </div>
        )}

        <ProgressSummary label={progressLabel} done={done} total={total} />

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

          {chips.length > 1 && (
            <div className="chip-row">
              <Chip
                label="All"
                open={todoItems.filter(it => !settledOf(it)).length}
                total={todoItems.length}
                active={filter === 'all' || !activeExists}
                onClick={() => setFilter('all')}
              />
              {chips.map(c => (
                <Chip
                  key={c.category.key}
                  label={c.category.label}
                  icon={c.category.icon}
                  color={c.category.color}
                  open={c.open}
                  total={c.total}
                  active={filter === c.category.key}
                  onClick={() => setFilter(filter === c.category.key ? 'all' : c.category.key)}
                />
              ))}
            </div>
          )}

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
                    readOnly={preview}
                  />
                ))}
              </AnimatePresence>
            </>
          )}

          {todoItems.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--page-text-dim)', padding: '14px 0', lineHeight: 1.7 }}>
              {preview
                ? <>Nothing on tomorrow’s plate yet. Hit <strong>＋ New task</strong> to plan ahead.</>
                : <>A clear day ahead. Hit <strong>＋ New task</strong> to add one — General by default, or file it under a questline, Vynues project, or your Chud-life habits.</>}
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

      {/* ── Day flipper ──────────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        <DayFlipper key={preview ? 'flip-back' : 'flip-fwd'} forward={!preview} onClick={() => setPreview(!preview)} />
      </AnimatePresence>

      <TaskCreateDrawer open={drawerOpen} initialCategory={drawerCategory} onClose={() => setDrawerOpen(false)} />
      <TaskEditDrawer target={editTarget} onClose={() => setEditTarget(null)} />
    </div>
  );
}
