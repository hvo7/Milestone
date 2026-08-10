import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Quest, Routine } from '../types';
import { useQuestStore, useUIStore, isArchivedRoutine, logicalDateKey, subtaskStats } from '../store';
import { RepeatPicker, RecurrenceBadge, type RepeatValue } from '../recurrence';
import QuestlineAccordionItem from '../components/QuestlineAccordionItem';
import AddModal from '../components/AddModal';
import QuestCreateDrawer from '../components/QuestCreateDrawer';
import TaskEditDrawer, { type EditTarget } from '../components/TaskEditDrawer';
import NavBar from '../components/NavBar';
import IconButton from '../components/IconButton';

// ── General: things to accomplish overall ────────────────────────────────────
// Uncategorized goals live here alongside the questlines — the "just get it
// done" bucket. One-time entries are truly one-time: once checked, they settle
// into Done and never come back (recurring ones reset on their cadence as usual).

function GeneralRow({ r, onEdit }: { r: Routine; onEdit: () => void }) {
  const toggleRoutine = useQuestStore(s => s.toggleRoutine);
  const deleteRoutine = useQuestStore(s => s.deleteRoutine);
  const [hovered, setHovered] = useState(false);

  const stats = subtaskStats(r.subtasks);
  const counter = r.target != null ? { done: r.progress ?? 0, total: r.target } : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: r.completed ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '9px 4px', borderBottom: '1px solid var(--card-border)',
      }}
    >
      <input
        type="checkbox"
        className="rune-check"
        checked={r.completed}
        onChange={() => toggleRoutine(r.id)}
        style={{ flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 14, fontWeight: 500,
          color: r.completed ? 'var(--page-text-dim)' : 'var(--page-text)',
          textDecoration: r.completed ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {r.title}
          {stats.total > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: stats.done === stats.total ? 'var(--success)' : 'var(--page-text-dim)' }}>
              {stats.done}/{stats.total}
            </span>
          )}
          {counter && !r.completed && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
              {counter.done}/{counter.total}{r.unit ? ` ${r.unit}` : ''}
            </span>
          )}
        </span>
        {r.description && (
          <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: 'var(--page-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.description}
          </span>
        )}
      </div>

      {r.recurring || r.intervalDays
        ? <RecurrenceBadge recurring={r.recurring} intervalDays={r.intervalDays} />
        : <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', flexShrink: 0, letterSpacing: '0.05em' }}>ONCE</span>}

      {(r.streak ?? 0) > 1 && (
        <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316', flexShrink: 0 }}>🔥{r.streak}</span>
      )}

      <IconButton
        onClick={onEdit}
        title="Edit everything — name, due date, schedule, steps…"
        rest={hovered ? 'var(--accent)' : undefined}
        opacity={hovered ? 1 : 0.35}
        style={{ padding: '2px 4px' }}
      >
        ✎
      </IconButton>
      <IconButton
        onClick={() => deleteRoutine(r.id)}
        title="Delete"
        hover="var(--danger)"
        size={12}
        opacity={hovered ? 1 : 0}
        style={{ padding: '2px 4px' }}
      >
        ✕
      </IconButton>
    </motion.div>
  );
}

function GeneralPanel({ onEdit }: { onEdit: (t: EditTarget) => void }) {
  const routines   = useQuestStore(s => s.routines);
  const addRoutine = useQuestStore(s => s.addRoutine);

  const [value, setValue]   = useState('');
  const [repeat, setRepeat] = useState<RepeatValue>({ recurring: null });
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const todayKey = logicalDateKey();
  const general = routines.filter(r => !r.questlineId && !r.anchor && !r.hidden && !isArchivedRoutine(r, todayKey));
  const open = general.filter(r => !r.completed);
  const done = general.filter(r => r.completed);

  function submit() {
    if (!value.trim()) return;
    addRoutine(value.trim(), '', repeat.recurring, undefined, repeat.intervalDays);
    setValue('');
    inputRef.current?.focus();
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="parchment"
      style={{ borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--page-text)' }}>General</h2>
        <span style={{ fontSize: 12, color: 'var(--page-text-dim)' }}>
          things to accomplish, no questline needed
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: open.length === 0 && general.length > 0 ? 'var(--success)' : 'var(--page-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {done.length}/{general.length}
        </span>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        One-time entries stay done once you finish them — they never come back. Repeating ones reset on their cadence.
      </p>

      <AnimatePresence initial={false}>
        {open.map(r => (
          <GeneralRow key={r.id} r={r} onEdit={() => onEdit({ kind: 'routine', id: r.id })} />
        ))}
      </AnimatePresence>

      {done.length > 0 && (
        <>
          <button
            onClick={() => setShowDone(v => !v)}
            className="btn-ghost"
            style={{ marginTop: 10, fontSize: 11.5, padding: '4px 10px', border: 'none' }}
          >
            {showDone ? '▾' : '▸'} Done · {done.length}
          </button>
          <AnimatePresence initial={false}>
            {showDone && done.map(r => (
              <GeneralRow key={r.id} r={r} onEdit={() => onEdit({ kind: 'routine', id: r.id })} />
            ))}
          </AnimatePresence>
        </>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            className="rune-input"
            placeholder="Add something to accomplish (e.g. Get a haircut)…"
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
    </motion.section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function QuestsPage() {
  const questlines     = useQuestStore(s => s.questlines);
  const editMode       = useUIStore(s => s.editMode);
  const toggleEditMode = useUIStore(s => s.toggleEditMode);

  const [openId, setOpenId]          = useState<string | null>(questlines[0]?.id ?? null);
  const [addingQuestline, setAdding] = useState(false);
  const [questDrawerOpen, setQuestDrawerOpen] = useState(false);
  const [editingQuest, setEditingQuest] = useState<{ questlineId: string; quest: Quest } | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const visible = questlines.filter(ql => editMode || !ql.hidden);
  const hasQuestlines = questlines.some(ql => !ql.hidden);

  return (
    <>
      <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
        <NavBar />

        <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px' }}>

          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h1 className="page-title" style={{ margin: 0 }}>
              Questlines
            </h1>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {hasQuestlines && (
                <button className="btn-gold" onClick={() => setQuestDrawerOpen(true)} style={{ fontSize: 13, padding: '6px 14px' }}>
                  ＋ New Quest
                </button>
              )}
              <button className="btn-ghost" onClick={() => setAdding(true)} style={{ fontSize: 13, padding: '6px 14px' }}>
                + New Questline
              </button>
              <button
                onClick={toggleEditMode}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 500,
                  padding: '6px 14px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: editMode ? '1px solid var(--accent-border)' : '1px solid var(--card-border)',
                  background: editMode ? 'var(--accent-soft)' : 'transparent',
                  color: editMode ? 'var(--accent)' : 'var(--text-dim)',
                  transition: 'all 0.2s',
                }}
              >
                {editMode ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>

          {/* General — the overall to-accomplish bucket */}
          <GeneralPanel onEdit={setEditTarget} />

          {visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.8 }}>
                No questlines yet.<br />Click <strong style={{ color: 'var(--accent)' }}>+ New Questline</strong> above to add your first one.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {visible.map((ql, i) => (
                <motion.div
                  key={ql.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.35 }}
                >
                  <QuestlineAccordionItem
                    questline={ql}
                    isOpen={openId === ql.id}
                    onToggle={() => setOpenId(p => (p === ql.id ? null : ql.id))}
                    onEditQuest={(questlineId, quest) => setEditingQuest({ questlineId, quest })}
                  />
                </motion.div>
              ))}
              {editMode && (
                <button className="btn-ghost" onClick={() => setAdding(true)} style={{ marginTop: 4 }}>
                  + New Questline
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {addingQuestline && (
        <AddModal mode={{ type: 'questline' }} onClose={() => setAdding(false)} />
      )}

      <QuestCreateDrawer
        open={questDrawerOpen || !!editingQuest}
        editing={editingQuest}
        onClose={() => { setQuestDrawerOpen(false); setEditingQuest(null); }}
      />

      <TaskEditDrawer target={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}
