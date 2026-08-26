import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RecurringType, MonthlyRule } from '../types';
import { useQuestStore, recurrenceLabel, isArchivedRoutine, isGeneralTask, ARCHIVE_RETENTION_DAYS, logicalDateKey, logicalDayStart } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { RepeatPicker, RecurrenceBadge, type RepeatValue } from '../recurrence';
import NavBar from '../components/NavBar';
import { categoryColor, cleanQuest, ANCHOR_LABEL, ANCHOR_ICON } from '../lib/ui';
import { duplicateGroups } from '../lib/duplicates';

/**
 * The same habit entered twice, offered as one click to fix.
 *
 * Shown here rather than on Today: Today is the day's work, and this is
 * housekeeping about the list itself. It renders nothing at all when there's
 * nothing to merge, so it costs a line of the page only when it's needed.
 */
function Duplicates() {
  const routines = useQuestStore(s => s.routines);
  const taskHistory = useQuestStore(s => s.taskHistory);
  const mergeRoutines = useQuestStore(s => s.mergeRoutines);

  const groups = duplicateGroups(routines.filter(r => !isArchivedRoutine(r)), taskHistory);
  if (!groups.length) return null;

  return (
    <div
      className="parchment"
      style={{ borderRadius: 14, padding: '14px 18px', marginBottom: 18, borderLeft: '3px solid #fbbf24' }}
    >
      <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--page-text)' }}>
        Entered twice
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.map(({ keep, drop }) => (
          <div key={keep.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--page-text)', minWidth: 0 }}>
              {keep.title}
              <span style={{ color: 'var(--page-text-dim)' }}>
                {drop.map(d => ` · ${d.title}`).join('')}
              </span>
            </span>
            <button
              type="button"
              className="rune-input"
              onClick={() => drop.forEach(d => mergeRoutines(keep.id, d.id))}
              // Says which name survives, because that is the part you can't
              // tell from a button called "Merge".
              title={`Keep “${keep.title}” — it takes the history, streak and systems of ${drop.map(d => `“${d.title}”`).join(', ')}`}
              style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 11px', width: 'auto' }}
            >
              Merge into “{keep.title}”
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A task normalised across the quest, routine and Vynues stores so every group
 *  renders and edits through one shape. */
interface AllTask {
  id: string;
  title: string;
  done: boolean;
  streak?: number;
  recurring: RecurringType | null;
  intervalDays?: number;
  monthlyRule?: MonthlyRule | null;
  /** Routines always repeat, so their picker hides the "Once" option. */
  repeatOnly: boolean;
  meta?: string;
  /** One-off due date ('YYYY-MM-DD') and its setter — only wired for tasks that support it. */
  dueDate?: string | null;
  onSetDueDate?: (dueDate: string | null) => void;
  /** "Show on Today" pin — wired for weekly/monthly/interval routines, which no
   *  longer appear on Today automatically (Today only carries work due that day). */
  tracked?: boolean;
  onToggleTracked?: () => void;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onRepeat: (v: RepeatValue) => void;
}

interface Group {
  id: string;
  name: string;
  color?: string;
  tasks: AllTask[];
}

// ── A single editable task row ────────────────────────────────────────────────

function AllRow({ task }: { task: AllTask }) {
  const [hovered, setHovered]   = useState(false);
  const [editing, setEditing]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft]       = useState(task.title);
  const editRef  = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  function startEdit() { setDraft(task.title); setEditing(true); }
  function commitEdit() {
    setEditing(false);
    if (cancelRef.current) { cancelRef.current = false; return; }
    const t = draft.trim();
    if (t && t !== task.title) task.onRename(t);
  }

  const label = recurrenceLabel(task);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: task.done ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      style={{ borderBottom: '1px solid var(--card-border)' }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px' }}
      >
        <input
          type="checkbox"
          className="rune-check"
          checked={task.done}
          onChange={task.onToggle}
          style={{ flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              ref={editRef}
              autoFocus
              className="rune-input"
              value={draft}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setDraft(e.target.value)}
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
              title="Double-click to rename"
              style={{
                display: 'block', fontSize: 14, fontWeight: 500, cursor: 'text',
                color: task.done ? 'var(--page-text-dim)' : 'var(--page-text)',
                textDecoration: task.done ? 'line-through' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {task.title}
            </span>
          )}
          {task.meta && (
            <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--page-text-dim)' }}>{task.meta}</span>
          )}
        </div>

        {label === 'Once'
          ? <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', flexShrink: 0 }}>Once</span>
          : <RecurrenceBadge recurring={task.recurring} intervalDays={task.intervalDays} monthlyRule={task.monthlyRule} />}

        {(task.streak ?? 0) > 1 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316', flexShrink: 0 }}>🔥{task.streak}</span>
        )}

        <button
          onClick={() => setExpanded(e => !e)}
          title="Edit schedule"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px',
            color: expanded ? 'var(--accent)' : (hovered ? 'var(--page-text)' : 'var(--text-dim)'),
            flexShrink: 0, transition: 'color 0.15s',
          }}
        >
          ⚙
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '4px 4px 16px 34px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--page-text-dim)' }}>Repeats</span>
                <RepeatPicker
                  value={{ recurring: task.recurring, intervalDays: task.intervalDays, monthlyRule: task.monthlyRule }}
                  onChange={task.onRepeat}
                  repeatOnly={task.repeatOnly}
                />
              </div>
              {task.onSetDueDate && !task.recurring && !task.monthlyRule && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--page-text-dim)' }}>Due</span>
                  <input
                    type="date"
                    className="rune-input"
                    value={task.dueDate ?? ''}
                    onChange={e => task.onSetDueDate!(e.target.value || null)}
                    style={{ fontSize: 12, padding: '5px 8px', cursor: 'pointer' }}
                  />
                </div>
              )}
              {task.onToggleTracked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--page-text-dim)' }}>Today</span>
                  <button
                    onClick={task.onToggleTracked}
                    title="General tasks and non-daily cadences stay off Today until you put them there — pin one to work on it today"
                    style={{
                      background: task.tracked ? 'var(--accent-soft)' : 'none',
                      border: `1px solid ${task.tracked ? 'var(--accent-border)' : 'var(--card-border)'}`,
                      borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px',
                      color: task.tracked ? 'var(--accent)' : 'var(--text-dim)', transition: 'all 0.15s',
                    }}
                  >
                    {task.tracked ? '📌 Pinned ✓' : 'Pin to Today'}
                  </button>
                </div>
              )}
              <button
                onClick={task.onDelete}
                style={{
                  marginLeft: 'auto', background: 'none', border: '1px solid var(--card-border)', borderRadius: 8,
                  cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px', color: 'var(--text-dim)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.color = 'var(--danger)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--card-border)'; e.currentTarget.style.color = 'var(--text-dim)'; }}
              >
                Delete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Add row for the General group ─────────────────────────────────────────────

function GeneralAddRow({ onAdd }: { onAdd: (title: string, repeat: RepeatValue) => void }) {
  const [value, setValue]   = useState('');
  const [repeat, setRepeat] = useState<RepeatValue>({ recurring: null });
  const ref = useRef<HTMLInputElement>(null);

  function submit() {
    if (!value.trim()) return;
    onAdd(value.trim(), repeat);
    setValue('');
    ref.current?.focus();
  }

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={ref}
          className="rune-input"
          placeholder="Add an uncategorized task (e.g. Get a haircut)…"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{ flex: 1 }}
        />
        <button className="btn-gold" onClick={submit} disabled={!value.trim()} style={{ opacity: value.trim() ? 1 : 0.35, padding: '6px 16px' }}>
          Add
        </button>
      </div>
      <RepeatPicker value={repeat} onChange={setRepeat} />
    </div>
  );
}

// ── Group panel ───────────────────────────────────────────────────────────────

function GroupPanel({ group, addSlot }: { group: Group; addSlot?: React.ReactNode }) {
  // Open tasks first, completed sink to the bottom.
  const open = group.tasks.filter(t => !t.done);
  const done = group.tasks.filter(t => t.done);
  const sorted = [...open, ...done];

  return (
    <section
      className="parchment"
      style={{ borderRadius: 12, padding: '16px 18px', marginBottom: 20, ...(group.color ? { borderLeft: `3px solid ${group.color}` } : {}) }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--page-text)' }}>{group.name}</h2>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: done.length === group.tasks.length && group.tasks.length > 0 ? 'var(--success)' : 'var(--page-text-dim)' }}>
          {done.length}/{group.tasks.length}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {sorted.map(t => <AllRow key={t.id} task={t} />)}
      </AnimatePresence>

      {group.tasks.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--page-text-dim)', padding: '4px 0' }}>No tasks here yet.</p>
      )}

      {addSlot}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AllPage() {
  const questlines  = useQuestStore(s => s.questlines);
  const routines    = useQuestStore(s => s.routines);
  const toggleRoutine       = useQuestStore(s => s.toggleRoutine);
  const updateRoutineTitle  = useQuestStore(s => s.updateRoutineTitle);
  const deleteRoutine       = useQuestStore(s => s.deleteRoutine);
  const setRoutineRecurring = useQuestStore(s => s.setRoutineRecurring);
  const setRoutineDueDate   = useQuestStore(s => s.setRoutineDueDate);
  const setRoutineCompleted = useQuestStore(s => s.setRoutineCompleted);
  const toggleRoutineTracked = useQuestStore(s => s.toggleRoutineTracked);
  const addRoutine          = useQuestStore(s => s.addRoutine);
  const toggleAction        = useQuestStore(s => s.toggleAction);
  const updateActionTitle   = useQuestStore(s => s.updateActionTitle);
  const deleteAction        = useQuestStore(s => s.deleteAction);
  const setActionRecurring  = useQuestStore(s => s.setActionRecurring);

  const projects     = useVynuesStore(s => s.projects);
  const toggleTask   = useVynuesStore(s => s.toggleTask);
  const updateTask   = useVynuesStore(s => s.updateTask);
  const deleteTask   = useVynuesStore(s => s.deleteTask);

  // Helper builders that normalise each store's task into an AllTask.
  const fromRoutine = (r: typeof routines[number]): AllTask => ({
    id: r.id, title: r.title, done: r.completed, streak: r.streak,
    recurring: r.recurring, intervalDays: r.intervalDays, monthlyRule: r.monthlyRule, repeatOnly: false,
    dueDate: r.dueDate,
    // The Today pin only matters for what Today doesn't auto-show: non-daily
    // cadences, and General one-offs, which wait to be pinned rather than
    // arriving on a due date the create drawer filled in with today.
    tracked: r.trackedToday,
    onToggleTracked: (r.recurring && r.recurring !== 'daily') || r.intervalDays
      || (!r.recurring && !r.intervalDays && !r.monthlyRule && isGeneralTask(r))
      ? () => toggleRoutineTracked(r.id)
      : undefined,
    onToggle: () => toggleRoutine(r.id),
    onRename: t => updateRoutineTitle(r.id, t),
    onDelete: () => deleteRoutine(r.id),
    onRepeat: v => setRoutineRecurring(r.id, v.recurring, v.intervalDays, v.monthlyRule),
    onSetDueDate: d => setRoutineDueDate(r.id, d),
  });

  // ── Build groups ───────────────────────────────────────────────────────────
  const todayKey = logicalDateKey();
  const generalTasks = routines.filter(r => !r.questlineId && !r.anchor && !r.hidden && !isArchivedRoutine(r, todayKey)).map(fromRoutine);
  const anchorTasks  = routines.filter(r => r.anchor && !r.hidden).map(fromRoutine);

  // Completed one-time General tasks move here the day after they're finished,
  // wait out their retention window, then delete themselves automatically.
  const archivedTasks: AllTask[] = routines
    .filter(r => !r.hidden && isArchivedRoutine(r, todayKey))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .map(r => {
      const completedDay = logicalDayStart(new Date(r.completedAt!));
      const daysLeft = Math.max(0, ARCHIVE_RETENTION_DAYS - Math.round((logicalDayStart().getTime() - completedDay.getTime()) / 86_400_000));
      return {
        ...fromRoutine(r),
        meta: `Completed ${completedDay.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${daysLeft === 0 ? 'auto-deletes today' : `auto-deletes in ${daysLeft}d`}`,
        // Un-checking restores the task to General without disturbing today's heatmap.
        onToggle: () => setRoutineCompleted(r.id, false),
      };
    });

  const questGroups: Group[] = questlines
    .filter(ql => !ql.hidden)
    .map(ql => {
      const actionTasks: AllTask[] = ql.quests.flatMap(q =>
        q.actions.filter(a => !a.hidden).map(a => ({
          id: a.id, title: a.title, done: a.completed,
          recurring: a.recurring ?? null, intervalDays: a.intervalDays, monthlyRule: a.monthlyRule, repeatOnly: false,
          meta: cleanQuest(q.title),
          onToggle: () => toggleAction(ql.id, q.id, a.id),
          onRename: (t: string) => updateActionTitle(ql.id, q.id, a.id, t),
          onDelete: () => deleteAction(ql.id, q.id, a.id),
          onRepeat: (v: RepeatValue) => setActionRecurring(ql.id, q.id, a.id, v.recurring, v.intervalDays, v.monthlyRule),
        }))
      );
      const linkedTasks = routines.filter(r => r.questlineId === ql.id && !r.hidden).map(fromRoutine);
      return { id: ql.id, name: ql.title, color: categoryColor(ql.color), tasks: [...linkedTasks, ...actionTasks] };
    })
    .filter(g => g.tasks.length > 0);

  const projectGroups: Group[] = projects.map(p => ({
    id: p.id,
    name: p.name,
    color: categoryColor(p.color),
    tasks: p.tasks.map(t => ({
      id: t.id, title: t.title, done: t.done, streak: t.streak,
      recurring: t.recurring ?? null, intervalDays: t.intervalDays, monthlyRule: t.monthlyRule, repeatOnly: false,
      onToggle: () => toggleTask(p.id, t.id),
      onRename: (title: string) => updateTask(p.id, t.id, { title }),
      onDelete: () => deleteTask(p.id, t.id),
      onRepeat: (v: RepeatValue) => updateTask(p.id, t.id, { recurring: v.recurring, intervalDays: v.intervalDays, monthlyRule: v.monthlyRule ?? null }),
    })),
  }));

  const totalTasks = generalTasks.length + anchorTasks.length + archivedTasks.length +
    questGroups.reduce((n, g) => n + g.tasks.length, 0) +
    projectGroups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <NavBar />

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px 60px' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 className="page-title" style={{ margin: 0 }}>All tasks</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--page-text-dim)' }}>
            {totalTasks} task{totalTasks === 1 ? '' : 's'}
          </p>
        </header>

        <Duplicates />

        {/* General — uncategorized */}
        <GroupPanel
          group={{ id: 'general', name: 'General', tasks: generalTasks }}
          addSlot={
            <GeneralAddRow onAdd={(title, repeat) => addRoutine(title, '', repeat.recurring, undefined, repeat.intervalDays, undefined, null, undefined, repeat.monthlyRule)} />
          }
        />

        {/* Anchor habits */}
        {anchorTasks.length > 0 && (
          <GroupPanel group={{ id: 'anchor', name: `${ANCHOR_ICON} ${ANCHOR_LABEL}`, color: 'var(--accent)', tasks: anchorTasks }} />
        )}

        {/* Per questline */}
        {questGroups.map(g => <GroupPanel key={g.id} group={g} />)}

        {/* Per Vynues project */}
        {projectGroups.map(g => <GroupPanel key={g.id} group={g} />)}

        {/* Archived — finished one-time tasks resting out their retention window */}
        {archivedTasks.length > 0 && (
          <GroupPanel
            group={{ id: 'archived', name: '🗄 Archived', tasks: archivedTasks }}
            addSlot={
              <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--page-text-dim)' }}>
                Deleted {ARCHIVE_RETENTION_DAYS} days after completion.
              </p>
            }
          />
        )}
      </div>
    </div>
  );
}
