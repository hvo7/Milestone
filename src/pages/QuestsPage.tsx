import { useState, useRef, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Quest } from '../types';
import { useQuestStore, useUIStore, isGeneralTask, routineSystemIds } from '../store';
import { RepeatPicker, type RepeatValue } from '../recurrence';
import QuestlineAccordionItem from '../components/QuestlineAccordionItem';
import MomentumPanel from '../components/MomentumPanel';
import AddModal from '../components/AddModal';
import QuestCreateDrawer from '../components/QuestCreateDrawer';
import type { EditTarget } from '../components/TaskEditDrawer';
import NavBar from '../components/NavBar';
import { lazyChunk } from '../lib/lazyChunk';
import QuestlineSidebar from '../components/QuestlineSidebar';
import RoutineTaskRow from '../components/RoutineTaskRow';
import { questlineHref, readQuestlineSelection, routineServesQuestline, selectionParams, systemServesQuestline } from '../lib/questlineNavigation';
import { systemRoutines } from '../lib/systems';
import '../components/questlineWorkspace.css';

// Opened on demand, so it stays out of the page's own chunk.
const TaskEditDrawer = lazyChunk(() => import('../components/TaskEditDrawer'));

// ── General: things to accomplish overall ────────────────────────────────────
// Uncategorized goals live here alongside the questlines — the "just get it
// done" bucket. One-time entries are truly one-time: once checked, they settle
// into Done and never come back (recurring ones reset on their cadence as usual).

function GeneralPanel({ onEdit }: { onEdit: (t: EditTarget) => void }) {
  const routines   = useQuestStore(s => s.routines);
  const addRoutine = useQuestStore(s => s.addRoutine);

  const [value, setValue]   = useState('');
  const [repeat, setRepeat] = useState<RepeatValue>({ recurring: null });
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // General is a task bucket, separate from the questline hierarchy.
  const general = routines.filter(r =>
    isGeneralTask(r) && !r.hidden);
  const open = general.filter(r => !r.completed);
  const done = general.filter(r => r.completed);

  function submit() {
    if (!value.trim()) return;
    addRoutine(value.trim(), '', repeat.recurring, undefined, repeat.intervalDays, undefined, undefined, undefined, repeat.monthlyRule);
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--page-text)' }}>General</h2>
        <span style={{ fontSize: 12, color: 'var(--page-text-dim)' }}>
          tasks, errands & commitments
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: open.length === 0 && general.length > 0 ? 'var(--success)' : 'var(--page-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {done.length}/{general.length}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {open.map(r => (
          <RoutineTaskRow key={r.id} routine={r} onEdit={() => onEdit({ kind: 'routine', id: r.id })} />
        ))}
      </AnimatePresence>

      {done.length > 0 && (
        <>
          <button
            onClick={() => setShowDone(v => !v)}
            className="btn-ghost"
            style={{ marginTop: 10, fontSize: 11.5, padding: '4px 10px', border: 'none' }}
          >
            {showDone ? '▾' : '▸'} Completed history · {done.length}
          </button>
          <AnimatePresence initial={false}>
            {showDone && done.map(r => (
              <RoutineTaskRow key={r.id} routine={r} onEdit={() => onEdit({ kind: 'routine', id: r.id })} />
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

  const systems = useQuestStore(s => s.systems);
  const routines = useQuestStore(s => s.routines);
  const [params, setParams] = useSearchParams();
  const [addingQuestline, setAdding] = useState(false);
  const [questDrawerOpen, setQuestDrawerOpen] = useState(false);
  const [editingQuest, setEditingQuest] = useState<{ questlineId: string; quest: Quest } | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const visible = questlines.filter(ql => editMode || !ql.hidden);
  const selection = readQuestlineSelection(params, visible);
  const selected = selection.kind === 'questline' ? visible.find(ql => ql.id === selection.id) : undefined;
  const serving = selected ? systems.filter(s => !s.hidden && systemServesQuestline(s, selected)) : [];
  // A direct task link remains visible even if its system serves another goal.
  const linked = selected ? routines.filter(r => (editMode || !r.hidden) && routineServesQuestline(r, selected)
    && !routineSystemIds(r).some(id => serving.some(sys => sys.id === id))) : [];

  return (
    <>
      <div className="page-shell" style={{ paddingBottom: 80 }}>
        <NavBar />

        <div className="questline-workspace">
          <QuestlineSidebar questlines={visible} systems={systems} selection={selection} mode="quests" onSelect={next => setParams(selectionParams(next))} />
          <div className="questline-main">

          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
            <h2 className="page-title" style={{ margin: 0 }}>{selected ? 'Your quests' : 'General'}</h2>
            <div className="questline-toolbar-actions">
              {selected && !selected.hidden && (
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

          {!selected ? <GeneralPanel onEdit={setEditTarget} /> : <>
            <QuestlineAccordionItem key={selected.id} questline={selected} isOpen onToggle={() => {}} detail
              onEditQuest={(questlineId, quest) => setEditingQuest({ questlineId, quest })} />
            <section className="parchment questline-section" style={{ marginTop: 18 }}>
              <div className="questline-section-header"><h2>Supporting systems</h2><Link className="btn-ghost" to={questlineHref('systems', selected.id)}>Manage systems →</Link></div>
              {serving.length ? serving.map(sys => <Link key={sys.id} className="questline-support-link" to={`${questlineHref('systems', selected.id)}&system=${encodeURIComponent(sys.id)}`}>
                <span>{sys.title}<small>{systemRoutines(routines, sys.id).map(r => r.title).join(' · ') || 'No habits yet'}</small></span><span aria-hidden="true">→</span>
              </Link>) : <p>No systems linked yet. Add a practice from Systems when you're ready.</p>}
            </section>
            {linked.length > 0 && <section className="parchment questline-section"><h2>Linked tasks</h2>
              {linked.map(r => <RoutineTaskRow key={r.id} routine={r} onEdit={() => setEditTarget({ kind: 'routine', id: r.id })} />)}
            </section>}
          </>}
          {questlines.length > 0 && <details className="questline-insights"><summary>Momentum across questlines</summary><MomentumPanel /></details>}
          </div>
        </div>
      </div>

      {addingQuestline && (
        <AddModal mode={{ type: 'questline' }} onClose={() => setAdding(false)} />
      )}

      <QuestCreateDrawer
        open={questDrawerOpen || !!editingQuest}
        initialQuestlineId={selected?.id}
        editing={editingQuest}
        onClose={() => { setQuestDrawerOpen(false); setEditingQuest(null); }}
      />

      <Suspense fallback={null}>
        {editTarget && <TaskEditDrawer target={editTarget} onClose={() => setEditTarget(null)} />}
      </Suspense>
    </>
  );
}
