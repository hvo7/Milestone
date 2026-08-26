import { useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuestStore, useUIStore, questlineProgress, systemGoalIds, systemQuestIds, routineSystemIds } from '../store';
import { cleanQuest } from '../lib/ui';
import { systemHealth, systemRoutines, healthHex } from '../lib/systems';
import QuestCard from '../components/QuestCard';
import RoutineCard from '../components/RoutineCard';
import ProgressBar from '../components/ProgressBar';
import AddModal from '../components/AddModal';
import QuestIcon from '../components/QuestIcon';

export default function QuestlinePage() {
  const { id } = useParams<{ id: string }>();
  const questlines = useQuestStore(s => s.questlines);
  const editMode = useUIStore(s => s.editMode);
  const toggleEditMode = useUIStore(s => s.toggleEditMode);
  const allRoutines = useQuestStore(s => s.routines);
  const systems = useQuestStore(s => s.systems);
  const taskHistory = useQuestStore(s => s.taskHistory);
  const reorderQuests = useQuestStore(s => s.reorderQuests);
  const questline = questlines.find(ql => ql.id === id);
  // Systems feeding this questline — either the direction as a whole, or one of
  // the quests inside it. Both belong on this page; which one they serve is what
  // the caption under each says.
  const questIdsHere = new Set((questlines.find(ql => ql.id === id)?.quests ?? []).map(q => q.id));
  const serving = systems
    .filter(sys => !sys.hidden && !!id
      && (systemGoalIds(sys).includes(id) || systemQuestIds(sys).some(qid => questIdsHere.has(qid))))
    .map(system => ({
      system,
      health: systemHealth(systemRoutines(allRoutines, system.id), taskHistory),
      habits: systemRoutines(allRoutines, system.id),
      // The quests inside this questline that it feeds, if any.
      quests: systemQuestIds(system)
        .filter(qid => questIdsHere.has(qid))
        .map(qid => (questlines.find(ql => ql.id === id)?.quests ?? []).find(q => q.id === qid))
        .filter((q): q is NonNullable<typeof q> => !!q),
    }));
  const [addingQuest, setAddingQuest] = useState(false);
  const [addingRoutineType, setAddingRoutineType] = useState<'daily' | 'weekly' | null>(null);
  const dragQuestId = useRef<string | null>(null);
  const [dragOverQuestId, setDragOverQuestId] = useState<string | null>(null);

  if (!questline) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          This questline no longer exists.
        </p>
        <Link to="/quests"><button className="btn-gold" style={{ marginTop: 20 }}>← Back to Quests</button></Link>
      </div>
    );
  }

  const { done, total } = questlineProgress(questline);
  const isComplete = total > 0 && done === total;

  const quests = [...questline.quests]
    .sort((a, b) => a.order - b.order)
    .filter(q => editMode || !q.hidden);

  // A quest is a goal or a one-off. The repeated actions that make a system run
  // are shown on the Systems tab — and as the system's own card lower down this
  // page — so listing them here as well made the goal look like a to-do list of
  // the same five habits.
  const linkedRoutines = allRoutines.filter(r =>
    r.questlineId === questline.id && !routineSystemIds(r).length && (editMode || !r.hidden));
  const dailyRoutines  = linkedRoutines.filter(r => r.recurring === 'daily');
  const weeklyRoutines = linkedRoutines.filter(r => r.recurring === 'weekly');

  function handleQuestDrop(dropId: string) {
    const fromId = dragQuestId.current;
    dragQuestId.current = null;
    setDragOverQuestId(null);
    if (!fromId || fromId === dropId || !questline) return;
    const ids = quests.map(q => q.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(dropId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    reorderQuests(questline.id, ids);
  }

  return (
    <>
      <div style={{ minHeight: '100vh', padding: '0 0 100px' }}>
        {/* ── Top bar ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 0' }}>
          <Link to="/quests" style={{ textDecoration: 'none' }}>
            <button className="btn-ghost" style={{ fontSize: 12 }}>← Back</button>
          </Link>
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

        {/* ── Hero ── */}
        <div style={{ textAlign: 'center', padding: '28px 24px 32px' }}>
          {questline.icon && (
            <div style={{ marginBottom: 12 }}>
              <QuestIcon icon={questline.icon} size={56} style={{ borderRadius: 10 }} />
            </div>
          )}
          <h1 style={{
            margin: '0 0 10px',
            fontSize: 'clamp(22px, 4vw, 30px)',
            fontWeight: 700,
            color: 'var(--page-text)',
            letterSpacing: '-0.02em',
            lineHeight: 1.25,
          }}>
            {questline.title}
          </h1>
          {questline.description && (
            <p style={{ maxWidth: 560, margin: '0 auto 22px', fontSize: 15, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {questline.description}
            </p>
          )}
          <div style={{ maxWidth: 400, margin: '0 auto 8px' }}>
            <ProgressBar done={done} total={total} color={questline.color} />
          </div>

          {isComplete && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: 'var(--success)' }}
            >
              ✓ Questline complete
            </motion.div>
          )}
        </div>

        {/* ── Quests — the goals this questline is made of ── */}
        <div data-section="quests" style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div className="rune-divider" style={{ flex: 1 }}>
              {total} Quest{total !== 1 ? 's' : ''}
            </div>
            {editMode && (
              <button className="btn-gold" onClick={() => setAddingQuest(true)} style={{ marginLeft: 16, flexShrink: 0, fontSize: 12 }}>
                + New Quest
              </button>
            )}
          </div>

          {quests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {editMode
                  ? 'No quests yet. Add one above.'
                  : 'No quests yet. Click Edit to add your first one.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {quests.map((quest, i) => (
                <motion.div
                  key={quest.id}
                  id={`quest-${quest.id}`}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.35, ease: 'easeOut' }}
                  onDragOver={editMode ? (e => { e.preventDefault(); setDragOverQuestId(quest.id); }) : undefined}
                  onDrop={editMode ? (() => handleQuestDrop(quest.id)) : undefined}
                  style={{
                    position: 'relative',
                    borderRadius: 12,
                    outline: editMode && dragOverQuestId === quest.id ? '2px dashed var(--accent-border)' : '2px dashed transparent',
                    outlineOffset: 3,
                    transition: 'outline-color 0.12s',
                  }}
                >
                  {editMode && (
                    <div
                      draggable
                      onDragStart={() => { dragQuestId.current = quest.id; }}
                      onDragEnd={() => { dragQuestId.current = null; setDragOverQuestId(null); }}
                      title="Drag to reorder quest"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, width: 'fit-content',
                        margin: '0 0 6px', padding: '3px 9px',
                        fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
                        background: 'var(--input-bg)', border: '1px solid var(--card-border)',
                        borderRadius: 6, cursor: 'grab', userSelect: 'none',
                      }}
                    >
                      ⠿ Drag to reorder
                    </div>
                  )}
                  <QuestCard quest={quest} questline={questline} />
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* ── Systems ──
            The other half of how this questline gets done. Quests above are what
            you're trying to reach; these are the processes running underneath —
            some pointed at the direction as a whole, some at one quest. */}
        {serving.length > 0 && (
          <div data-section="systems" style={{ maxWidth: 680, margin: '32px auto 0', padding: '0 20px' }}>
            <div className="rune-divider" style={{ marginBottom: 16 }}>
              {serving.length} System{serving.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {serving.map(({ system, health, habits, quests: forQuests }) => (
                <Link
                  key={system.id}
                  to="/systems"
                  className="parchment"
                  style={{
                    display: 'block', textDecoration: 'none', borderRadius: 12, padding: '13px 16px',
                    borderLeft: '3px solid var(--accent)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <QuestIcon icon={system.icon || '⚙️'} size={16} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--page-text)', flex: 1, minWidth: 0 }}>
                      {system.title}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: healthHex(health.rate), fontVariantNumeric: 'tabular-nums' }}>
                      {health.rate == null ? '—' : `${Math.round(health.rate * 100)}%`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, color: 'var(--page-text-dim)' }}>
                      {habits.map(h => h.title).join(' · ') || 'No habits yet'}
                    </span>
                  </div>
                  {forQuests.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                      {forQuests.map(q => (
                        <span
                          key={q.id}
                          style={{
                            fontSize: 10.5, padding: '1px 8px', borderRadius: 999,
                            border: '1px solid var(--card-border)', color: 'var(--page-text-dim)',
                          }}
                        >
                          for {cleanQuest(q.title)}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Linked recurring tasks ── */}
        {(dailyRoutines.length > 0 || weeklyRoutines.length > 0 || editMode) && (
          <div style={{ maxWidth: 680, margin: '32px auto 0', padding: '0 20px' }}>
            {(dailyRoutines.length > 0 || editMode) && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div className="rune-divider" style={{ flex: 1 }}>Daily Tasks</div>
                  {editMode && (
                    <button className="btn-ghost" onClick={() => setAddingRoutineType('daily')} style={{ marginLeft: 16, flexShrink: 0, fontSize: 11 }}>
                      + Add
                    </button>
                  )}
                </div>
                {dailyRoutines.length === 0 && editMode && (
                  <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                    No daily tasks linked yet.
                  </p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dailyRoutines.map((routine, i) => (
                    <motion.div key={routine.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3 }}>
                      <RoutineCard routine={routine} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {(weeklyRoutines.length > 0 || editMode) && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div className="rune-divider" style={{ flex: 1 }}>Weekly Tasks</div>
                  {editMode && (
                    <button className="btn-ghost" onClick={() => setAddingRoutineType('weekly')} style={{ marginLeft: 16, flexShrink: 0, fontSize: 11 }}>
                      + Add
                    </button>
                  )}
                </div>
                {weeklyRoutines.length === 0 && editMode && (
                  <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                    No weekly tasks linked yet.
                  </p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {weeklyRoutines.map((routine, i) => (
                    <motion.div key={routine.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.3 }}>
                      <RoutineCard routine={routine} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {addingQuest && (
        <AddModal mode={{ type: 'quest', questlineId: questline.id }} onClose={() => setAddingQuest(false)} />
      )}

      {addingRoutineType && (
        <AddModal
          mode={{ type: 'routine', recurring: addingRoutineType, questlineId: questline.id }}
          onClose={() => setAddingRoutineType(null)}
        />
      )}
    </>
  );
}
