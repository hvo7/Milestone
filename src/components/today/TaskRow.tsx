/**
 * One row of the Today list, whatever it came from — a routine, a quest action, a
 * pinned quest, a Vynues task. The page normalises all four into the props below,
 * which is what lets them sort, drag and reorder as a single list.
 */
import { useState, useRef } from 'react';
import { motion, Reorder, useDragControls, type PanInfo } from 'framer-motion';
import SubtaskTree, { type SubNode, type SubtaskTreeHandlers } from '../SubtaskTree';
import IconButton from '../IconButton';
import { countSubNodes, hasCheckpoints } from '../../lib/ui';
import { SessionStrip, CheckpointPips } from './ProgressStrip';

/** What, if anything, to draw under this row. Only ever one of the two: a goal
 *  counting days doesn't also have a quantity ladder. */
export type RowStrip =
  | { kind: 'sessions'; days: string[]; logged: string[]; onToggle: (dayKey: string) => void }
  | { kind: 'checkpoints'; onSet: (value: number) => void };

export interface DragHandlers {
  /** This row's identity for framer-motion's `Reorder.Group`. */
  value: string;
  onDragStart: () => void;
  onDrag: (e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => void;
  onDragEnd: () => void;
  /** Keyboard equivalents of the drag. Pointer-only reordering is unusable
   *  without a mouse, and the grip is otherwise unreachable by tab. */
  onMoveUp: () => void;
  onMoveDown: () => void;
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

export interface TaskRowProps {
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
  /** The day strip / checkpoint ladder drawn under the row, when the task is one
   *  of the shapes that needs it. */
  strip?: RowStrip;
  readOnly?: boolean;
}

export default function TaskRow({
  title, completed, todayDone = false, skipped, onSkip, streak, accentHex, sourceLine, tag, onToggle, onDelete, onRename, onEdit, drag,
  subtasks, subHandlers,
  target, progress, step, unit, onIncrement, strip, readOnly = false,
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
          <button
            type="button"
            // A real button, not a span: the grip has to be reachable by tab, and
            // arrow keys have to do what dragging does. The row itself is still
            // draggable from anywhere; this stays the visual affordance (and the
            // touch target, where `touch-action` has to be suppressed).
            onPointerDown={e => dragControls.start(e)}
            onKeyDown={e => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              // Otherwise the arrow scrolls the page out from under the row.
              e.preventDefault();
              if (e.key === 'ArrowUp') drag.onMoveUp(); else drag.onMoveDown();
            }}
            title="Drag to reorder, or focus and use ↑ ↓"
            aria-label={`Reorder ${title}. Press up or down arrow to move it.`}
            style={{
              flexShrink: 0, color: 'var(--text-dim)', fontSize: 16, lineHeight: 1,
              background: 'none', border: 'none', padding: 0,
              cursor: 'grab', userSelect: 'none', touchAction: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 28, borderRadius: 6,
              opacity: hovered ? 0.85 : 0.45, transition: 'opacity 0.15s',
            }}
          >
            ⠿
          </button>
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
            // Without this the row announces only "checkbox, unchecked" — the
            // title sits in a sibling element the checkbox has no relation to.
            aria-label={title}
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

      {/* The day strip / checkpoint ladder, indented to line up with the title
          rather than the grip. Sits above the steps: it's this task's own
          progress, where the steps below are its breakdown. */}
      {strip?.kind === 'sessions' && target != null && (
        <SessionStrip
          days={strip.days}
          logged={strip.logged}
          target={target}
          indent={drag ? 42 : 30}
          onToggle={strip.onToggle}
          readOnly={readOnly}
        />
      )}
      {strip?.kind === 'checkpoints' && target != null && hasCheckpoints(target, step ?? 1) && (
        <CheckpointPips
          progress={progress ?? 0}
          target={target}
          step={step ?? 1}
          unit={unit}
          indent={drag ? 42 : 30}
          onSet={strip.onSet}
          readOnly={readOnly}
        />
      )}

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
