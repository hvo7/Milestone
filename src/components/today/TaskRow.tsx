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
/** Systems offered by a row's tag menu, plus the ones it currently sits in. */
export interface SystemMenu {
  options: { id: string; label: string }[];
  /** Every system this row is part of — a habit can be in more than one. */
  values: string[];
  /** Adds or removes that one membership. */
  onToggle: (id: string) => void;
  /** Takes it out of every system at once. */
  onClear: () => void;
}

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
function CounterControl({ progress, target, step = 1, unit, complete, accentHex, onIncrement, readOnly = false, wide = false, indent = 0 }: {
  progress: number; target: number; step?: number; unit?: string;
  complete: boolean; accentHex: string; onIncrement: (delta: number) => void;
  readOnly?: boolean;
  /** Rail variant: −, a full-width bar, ＋ on their own line under the title.
   *  The reading is printed on the row's meta line instead, which is what keeps
   *  a unit like "Minutes Reading" from eating the title's width. */
  wide?: boolean;
  indent?: number;
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
  const bar = (height: number) => (
    <div style={{ height, background: 'var(--track-bg)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.3s cubic-bezier(.22,1,.36,1)' }} />
    </div>
  );

  if (wide) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9, paddingLeft: indent }}>
        {stepBtn('−', -step, progress <= 0)}
        <div style={{ flex: 1, minWidth: 0 }}>{bar(5)}</div>
        {stepBtn('＋', step, complete)}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, minWidth: 104, alignSelf: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {stepBtn('−', -step, progress <= 0)}
        <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 700, color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {progress}/{target}{unit ? ` ${unit}` : ''}
        </span>
        {stepBtn('＋', step, complete)}
      </div>
      {bar(3.5)}
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
  /** Makes the tag a button that reassigns the row's system in place. Rename is
   *  on double-click, so a single click on the tag is free for this. */
  systemMenu?: SystemMenu;
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
  /**
   * The anchor rail's variant: one column, not four.
   *
   * The rail is 300px wide, so the full row's single line — grip, counter,
   * title, cadence, streak, buttons — had ~80px left for the title and wrapped
   * it a word at a time. Compact gives the title the whole width and puts
   * everything else on its own line beneath: cadence and reading as one quiet
   * caption, then the counter, then the strip. Nothing is taken away — skip,
   * edit, rename, steps and the pips all still work, they just queue up
   * vertically instead of fighting over the same 300px.
   */
  compact?: boolean;
}

/**
 * The row's category label, as a control that reassigns its system in place.
 *
 * Attaching a habit to a system is the kind of thing you decide while looking at
 * the day's list, not while sitting in a form — so it happens on the row, where
 * the thought occurs. Left as plain text when there are no systems to pick from.
 */
function TagMenu({ label, color, menu }: { label: string; color: string; menu: SystemMenu }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        // The row uses double-click to rename; this must not start that.
        onDoubleClick={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title="Change which systems this belongs to"
        style={{
          font: 'inherit', fontWeight: 700, color, background: 'none', cursor: 'pointer',
          border: 'none', borderBottom: '1px dashed transparent', padding: 0,
          borderBottomColor: open ? color : 'transparent',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderBottomColor = color; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderBottomColor = 'transparent'; }}
      >
        {label}
      </button>

      {open && (
        <>
          {/* Catches the next click anywhere so the menu closes like a menu. */}
          <span
            onClick={e => { e.stopPropagation(); setOpen(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <span
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 41,
              minWidth: 190, display: 'block', padding: 5, borderRadius: 10,
              background: 'var(--card-bg-raised)', border: '1px solid var(--card-border)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.34)',
            }}
          >
            {/* Ticks rather than a single choice, and the menu stays open: a habit
                can be part of several systems, so picking one is rarely the end of
                the thought. */}
            {menu.options.map(o => {
              const on = menu.values.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={e => { e.stopPropagation(); menu.onToggle(o.id); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
                    fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer',
                    padding: '6px 9px', borderRadius: 7, border: 'none',
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    color: on ? 'var(--accent)' : 'var(--page-text)',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 11, width: 10, flexShrink: 0 }}>{on ? '✓' : ''}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.label}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); menu.onClear(); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit',
                fontSize: 12.5, cursor: 'pointer', padding: '6px 9px', borderRadius: 7,
                border: 'none', background: 'transparent', color: 'var(--text-dim)',
                borderTop: '1px solid var(--card-border)', marginTop: 3,
              }}
            >
              {menu.values.length ? 'Remove from all systems' : 'Not part of a system'}
            </button>
          </span>
        </>
      )}
    </span>
  );
}

export default function TaskRow({
  title, completed, todayDone = false, skipped, onSkip, streak, accentHex, sourceLine, tag, systemMenu, onToggle, onDelete, onRename, onEdit, drag,
  subtasks, subHandlers,
  target, progress, step, unit, onIncrement, strip, readOnly = false, compact = false,
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
    // The rail spaces its rows with a container gap, so the row drops its own
    // margin, and tightens up: it is a column of habits, not a page of cards.
    ...(compact ? { padding: '10px 12px', borderRadius: 10, marginBottom: 0 } : {}),
  };

  // Grabbing the row anywhere drags it — the way reorderable lists behave
  // elsewhere — while clicks on the controls inside it still do their own thing.
  function startRowDrag(e: React.PointerEvent) {
    if (!drag || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE_SEL)) return;
    dragControls.start(e);
  }

  // ── The rail variant ────────────────────────────────────────────────────
  // Title first and alone; everything else queues beneath it. RAIL_INDENT is the
  // checkbox plus its gap, so the caption, counter, pips and steps all line up
  // under the title rather than under the circle.
  const RAIL_INDENT = 29;
  // Where the ladder is drawn, it *is* the control — tapping 20 sets 20, and
  // tapping the rung you are on steps back off it. A bar and a pair of ± buttons
  // above it would be a second way to say the same thing, on a row 300px wide.
  const railLadder = strip?.kind === 'checkpoints' && target != null && hasCheckpoints(target, step ?? 1);
  const railValue = isCounter
    ? (strip?.kind === 'sessions'
        ? `${progress ?? 0}/${target} this cycle`
        : `${progress ?? 0}/${target}${unit ? ` ${unit}` : ''}`)
    : undefined;

  const compactContent = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {isCounter ? (
          // A counter has no single "done" tick to offer here — its control is the
          // line below. The gutter stays, so every title starts in the same column
          // and the rail reads as one list.
          <span aria-hidden="true" style={{ width: 19, flexShrink: 0 }} />
        ) : (
          <input
            type="checkbox"
            className="rune-check"
            checked={completed}
            onChange={onToggle}
            disabled={readOnly}
            aria-label={title}
            title={readOnly ? 'Come back tomorrow to check this off' : subCount.total > 0 ? 'Completes every step too' : undefined}
            style={{ flexShrink: 0, marginTop: 1, ...(readOnly ? { cursor: 'default', opacity: 0.6 } : {}) }}
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
              style={{ width: '100%', fontSize: 13.5, fontWeight: 500, padding: '3px 7px' }}
            />
          ) : (
            <span
              onDoubleClick={startEdit}
              title={onRename ? 'Double-click to rename' : undefined}
              style={{
                display: 'block',
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: 1.35,
                color: completed || skipped ? 'var(--page-text-dim)' : 'var(--page-text)',
                textDecoration: completed ? 'line-through' : 'none',
                cursor: onRename ? 'text' : undefined,
                overflowWrap: 'anywhere',
              }}
            >
              {title}
            </span>
          )}

          {/* One quiet caption for everything the row used to say in four places:
              how often it comes back, where the count is, the streak, the state.
              Dot-spaced so it stays one line for as long as it can. */}
          <span
            style={{
              display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 7px',
              marginTop: 3, fontSize: 10.5, fontWeight: 600, color: 'var(--page-text-dim)',
              fontVariantNumeric: 'tabular-nums', lineHeight: 1.4,
            }}
          >
            {sourceLine}
            {railValue && <span>{railValue}</span>}
            {(streak ?? 0) > 0 && <span style={{ color: '#f97316' }}>🔥{streak}</span>}
            {todayDone && !completed && <span style={{ color: 'var(--success)' }}>✓ done today</span>}
            {skipped && <span style={{ color: SKIP_COLOR }}>skipped</span>}
            {subCount.total > 0 && (
              <span style={{ color: subCount.done === subCount.total ? 'var(--success)' : 'var(--page-text-dim)' }}>
                {subCount.done}/{subCount.total} steps
              </span>
            )}
          </span>
        </div>

        {/* Half-lit rather than hover-only: the rail is the first thing on the
            page on a phone, where there is no hover to reveal anything with. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, marginTop: -1 }}>
          {onSkip && !completed && (
            <IconButton
              onClick={onSkip}
              title={skipped
                ? 'Skipped today — click to un-skip'
                : "Skip just today — streak safe, back tomorrow. A weekly goal keeps its progress."}
              rest={skipped ? SKIP_COLOR : undefined}
              hover={SKIP_COLOR}
              opacity={skipped || hovered ? 1 : 0.45}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <SkipIcon size={12} />
            </IconButton>
          )}
          {subtasksEnabled && !completed && !skipped && hovered && (
            <IconButton onClick={() => setAddingSub(v => !v)} title="Add a step" size={14}>
              ＋
            </IconButton>
          )}
          {onEdit && (
            <IconButton
              onClick={onEdit}
              title="Edit everything — name, schedule, target, steps…"
              size={12}
              opacity={hovered || editing ? 1 : 0.45}
            >
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

      {/* The counter, full width under the title. A session goal skips it — its
          day pips below *are* the control, and −/＋ beside them only invited the
          "three gym visits from one sofa" the day strip exists to prevent. */}
      {isCounter && strip?.kind !== 'sessions' && !railLadder && (
        <CounterControl
          wide
          indent={RAIL_INDENT}
          progress={progress ?? 0}
          target={target!}
          step={step}
          unit={unit}
          complete={completed || (progress ?? 0) >= target!}
          accentHex={todayDone ? 'var(--success)' : accentHex}
          onIncrement={onIncrement!}
          readOnly={readOnly}
        />
      )}

      {strip?.kind === 'sessions' && target != null && (
        <SessionStrip
          compact
          days={strip.days}
          logged={strip.logged}
          target={target}
          indent={RAIL_INDENT}
          onToggle={strip.onToggle}
          readOnly={readOnly}
        />
      )}
      {strip?.kind === 'checkpoints' && target != null && hasCheckpoints(target, step ?? 1) && (
        <CheckpointPips
          compact
          progress={progress ?? 0}
          target={target}
          step={step ?? 1}
          unit={unit}
          indent={RAIL_INDENT}
          onSet={strip.onSet}
          readOnly={readOnly}
        />
      )}

      {(subs.length > 0 || addingSub) && subHandlers && (
        <div style={{ marginTop: 8, paddingLeft: RAIL_INDENT }}>
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

  const fullContent = (
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
            // Dropped past the questline line so it sits against the title, which
            // is the thing it ticks off.
            style={{ flexShrink: 0, marginTop: tag ? 18 : 0, ...(readOnly ? { cursor: 'default', opacity: 0.6 } : {}) }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Above the task rather than in front of it. Inline, the questline was
              the first thing on every row and the same weight as the task, so a
              list of eight tasks read as eight questlines. On its own line it
              labels the row without competing with what the row is asking of you
              — and it stays put while the title is being renamed. */}
          {tag && (
            <span style={{ display: 'block', fontSize: 12, lineHeight: 1.35, marginBottom: 1 }}>
              {systemMenu
                ? <TagMenu label={tag.label} color={tag.color} menu={systemMenu} />
                : <span style={{ fontWeight: 700, color: tag.color }}>{tag.label}</span>}
            </span>
          )}
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
                // Large but unweighted: the questline above carries the bold, and
                // two bold lines on one row is two headings and no body.
                fontSize: 14.5,
                fontWeight: 400,
                color: completed || skipped ? 'var(--page-text-dim)' : 'var(--page-text)',
                textDecoration: completed ? 'line-through' : 'none',
                lineHeight: 1.4,
                cursor: onRename ? 'text' : undefined,
              }}
            >
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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, marginTop: 2 }}>
          {/* The cadence lives on the right, not on a third line under the title.
              It says how often the task comes back, which is standing information
              about the task — it doesn't need a line of its own on every row. */}
          {sourceLine && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginRight: 2 }}>
              {sourceLine}
            </span>
          )}
          {/* Shown from 1, not 2: a streak you set by hand has to appear, or the
              edit reads as having silently failed. */}
          {(streak ?? 0) > 0 && (
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

  const rowContent = compact ? compactContent : fullContent;

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
