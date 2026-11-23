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
import { routineIsArchived } from '../lib/archive';
import { lazyChunk } from '../lib/lazyChunk';
import QuestlineColdList from '../components/QuestlineColdList';
import PageBanner from '../components/PageBanner';
import Icon from '../components/Icon';
import { questlineMomentum, rankByNeglect } from '../lib/momentum';
import RoutineTaskRow from '../components/RoutineTaskRow';
import { questlineHref, readQuestlineSelection, routineServesQuestline, selectionParams, systemServesQuestline } from '../lib/questlineNavigation';
import { systemRoutines } from '../lib/systems';
import '../components/questlineWorkspace.css';
import './questsPondside.css';

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
      className="questline-panel"
    >
      <header className="questline-panel-head">
        <div className="questline-panel-title"><h2>General</h2></div>
        <div className="questline-panel-progress">
          <div className="progress-track" role="progressbar" aria-label="General tasks complete" aria-valuemin={0} aria-valuemax={general.length} aria-valuenow={done.length}>
            <div className="progress-fill" style={{ width: `${general.length ? Math.round(100 * done.length / general.length) : 0}%` }} />
          </div>
          <span>{done.length} of {general.length}</span>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {open.map(r => (
          <RoutineTaskRow key={r.id} routine={r} onEdit={() => onEdit({ kind: 'routine', id: r.id })} />
        ))}
      </AnimatePresence>

      {done.length > 0 && (
        <>
          <button
            onClick={() => setShowDone(v => !v)}
            className="btn-quiet"
            aria-expanded={showDone}
            style={{ marginTop: 10 }}
          >
            Completed · {done.length}
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
          <button type="button" className="btn-gold" onClick={submit} disabled={!value.trim()}>
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
  const taskHistory = useQuestStore(s => s.taskHistory);
  const [params, setParams] = useSearchParams();
  const [addingQuestline, setAdding] = useState(false);
  const [questDrawerOpen, setQuestDrawerOpen] = useState(false);
  const [editingQuest, setEditingQuest] = useState<{ questlineId: string; quest: Quest } | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const visible = questlines.filter(ql => !ql.hidden);
  // Coldest first. With nothing chosen, the coldest questline is the one shown.
  const ranked = rankByNeglect(visible.map(ql => questlineMomentum(ql, routines, taskHistory)));
  const selection = readQuestlineSelection(params, ranked.map(m => m.questline));
  const selected = selection.kind === 'questline' ? visible.find(ql => ql.id === selection.id) : undefined;
  const serving = selected ? systems.filter(s => !s.hidden && systemServesQuestline(s, selected)) : [];
  // A direct task link remains visible even if its system serves another goal.
  const linked = selected ? routines.filter(r => !routineIsArchived(r, questlines, systems) && routineServesQuestline(r, selected)
    && !routineSystemIds(r).some(id => serving.some(sys => sys.id === id))) : [];
  const generalOpen = routines.filter(r => isGeneralTask(r) && !r.hidden && !r.completed).length;
  // On a phone the panes stack: the list first, and a chosen questline as its own
  // view with Back. "Chosen" means the address says so, not the desktop default.
  const chosen = params.has('questline') || params.has('view');

  return (
    <>
      <div className="page-shell quests-page" style={{ paddingBottom: 80 }}>
        <NavBar hideCover />

        <main className="quests-shell" data-chosen={chosen || undefined}>
          <PageBanner pathname="/quests" />
          <header className="quests-head">
            <h1 className="page-title">Quests</h1>
            <div className="quests-actions">
              <button type="button" className="btn-quiet" aria-pressed={editMode} onClick={toggleEditMode}>{editMode ? 'Done' : 'Edit'}</button>
              <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>New questline</button>
              <button type="button" className="btn-gold" disabled={!selected} onClick={() => setQuestDrawerOpen(true)}>New quest</button>
            </div>
          </header>

          <div className="quests-panes">
            <QuestlineColdList ranked={ranked} selection={selection} generalOpen={generalOpen}
              onSelect={next => setParams(selectionParams(next))} />

            <section className="quests-detail" aria-label={selected ? selected.title : 'General'}>
              <button type="button" className="btn-quiet quests-back" onClick={() => setParams(new URLSearchParams())}>
                <Icon name="back" size={16} />Back
              </button>
              {!selected ? <GeneralPanel onEdit={setEditTarget} /> : <>
                <QuestlineAccordionItem key={selected.id} questline={selected} isOpen onToggle={() => {}} detail
                  onEditQuest={(questlineId, quest) => setEditingQuest({ questlineId, quest })} />
                <section className="quests-section">
                  <div className="questline-section-header"><h2>Supporting systems</h2><Link className="btn-ghost" to={questlineHref('systems', selected.id)}>Manage systems</Link></div>
                  {serving.length ? serving.map(sys => <Link key={sys.id} className="questline-support-link" to={`${questlineHref('systems', selected.id)}&system=${encodeURIComponent(sys.id)}`}>
                    <span>{sys.title}<small>{systemRoutines(routines, sys.id).map(r => r.title).join(' · ') || 'No habits yet'}</small></span><Icon name="chevron" size={16} />
                  </Link>) : <p>No systems linked yet.</p>}
                </section>
                {linked.length > 0 && <section className="quests-section"><h2>Linked tasks</h2>
                  {linked.map(r => <RoutineTaskRow key={r.id} routine={r} onEdit={() => setEditTarget({ kind: 'routine', id: r.id })} />)}
                </section>}
              </>}
              {questlines.length > 0 && <details className="questline-insights"><summary>Momentum across questlines</summary><MomentumPanel /></details>}
            </section>
          </div>
        </main>
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
