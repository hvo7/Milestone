import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Questline, Quest } from '../types';
import {
  isQuestComplete,
  isQuestUnlocked,
  getActiveQuest,
  questlineProgress,
  questProgress,
  useQuestStore,
  useUIStore,
} from '../store';
import ProgressBar from './ProgressBar';
import ActionItem from './ActionItem';
import AddModal from './AddModal';
import EditQuestlineModal from './EditQuestlineModal';
import QuestIcon from './QuestIcon';
import PinButton from './PinButton';
import { categoryColor, cleanQuest } from '../lib/ui';

/** Tooltip for the quest-level pin. Pinning puts the quest on the Today list as a
 *  single item, with its tasks (if any) as check-off steps beneath it. */
function questPinTitle(quest: Quest): string {
  if (quest.trackedToday) return 'Pinned to Today — click to unpin';
  const n = quest.actions.filter(a => !a.hidden).length;
  return n > 0
    ? `Pin this quest to Today (with its ${n} task${n === 1 ? '' : 's'})`
    : 'Pin this quest to Today';
}

/**
 * A small ✎ button that sits at the right edge of a quest row and opens the
 * side drawer to edit that quest's full details — the same right-aligned
 * row-action placement the Today tab uses.
 */
function EditPencil({ onClick, title = 'Edit quest' }: { onClick: (e: React.MouseEvent) => void; title?: string }) {
  return (
    <button
      // Quest rows are clickable (they expand), so row actions must not bubble.
      onClick={e => { e.stopPropagation(); onClick(e); }}
      title={title}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13, lineHeight: 1, padding: '0 2px', flexShrink: 0,
        color: 'var(--text-dim)', transition: 'color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
    >
      ✎
    </button>
  );
}

/** The red ✕ at the right edge of every quest row — one click deletes the quest
 *  (its tasks go with it; any linked Today routines are detached, not deleted). */
function DeleteQuestX({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(e); }}
      title="Delete quest"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 12, lineHeight: 1, padding: '0 2px', flexShrink: 0,
        color: 'var(--danger)', opacity: 0.65, transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '0.65')}
    >
      ✕
    </button>
  );
}

/**
 * A quest other than the active one: a compact row that expands to reveal its
 * tasks, so any task can be checked off or pinned to Today without leaving the
 * Quests tab. Previously these rows were closed surfaces — only the active
 * quest showed its tasks, so everything else could only be pinned by opening
 * the questline's own page.
 */
function CompactQuestRow({ questline, quest, locked, onEditQuest, onDelete }: {
  questline: Questline;
  quest: Quest;
  locked: boolean;
  onEditQuest?: (questlineId: string, quest: Quest) => void;
  onDelete: () => void;
}) {
  const toggleQuestTracked = useQuestStore(s => s.toggleQuestTracked);
  const [hovered, setHovered]   = useState(false);
  const [expanded, setExpanded] = useState(false);

  const complete = isQuestComplete(quest);
  const { done: ad, total: at } = questProgress(quest);
  const actions = quest.actions.filter(a => !a.hidden);
  const pinned = !!quest.trackedToday;
  const canExpand = actions.length > 0;

  return (
    <div style={{
      background: 'var(--input-bg)',
      borderRadius: 8,
      border: `1px solid ${pinned ? 'var(--accent-border)' : 'var(--card-border)'}`,
      opacity: locked ? 0.5 : 0.9,
      overflow: 'hidden',
      transition: 'border-color 0.18s',
    }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => canExpand && setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
          cursor: canExpand ? 'pointer' : 'default', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 12, width: 16, textAlign: 'center', flexShrink: 0, color: complete ? 'var(--success)' : 'var(--text-dim)' }}>
          {complete ? '✓' : locked ? '🔒' : '•'}
        </span>
        <span style={{
          flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0,
          color: complete ? 'var(--text-dim)' : 'var(--text-parchment)',
          textDecoration: complete && !quest.recurring ? 'line-through' : 'none',
        }}>
          {cleanQuest(quest.title)}
        </span>

        {quest.recurring && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>
            {quest.recurring === 'daily' ? 'Daily' : quest.recurring === 'weekly' ? 'Weekly' : 'Monthly'}
          </span>
        )}
        {!complete && !locked && at > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>{ad}/{at}</span>
        )}
        {complete && !quest.recurring && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--success)', flexShrink: 0 }}>DONE</span>
        )}
        {locked && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', flexShrink: 0 }}>LOCKED</span>
        )}

        {!locked && (
          <PinButton
            state={pinned ? 'all' : 'none'}
            hovered={hovered}
            onClick={() => toggleQuestTracked(questline.id, quest.id)}
            title={questPinTitle(quest)}
          />
        )}
        <EditPencil onClick={() => onEditQuest?.(questline.id, quest)} />
        <DeleteQuestX onClick={onDelete} />
        {canExpand && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.25 }}
            style={{ color: 'var(--text-dim)', fontSize: 9, display: 'inline-block', flexShrink: 0 }}
          >
            ▼
          </motion.span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && canExpand && (
          <motion.div
            key="tasks"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '2px 12px 6px 38px' }}>
              {actions.map(action => (
                <ActionItem
                  key={action.id}
                  action={action}
                  questlineId={questline.id}
                  questId={quest.id}
                  locked={locked}
                  parentRecurring={!!quest.recurring}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface Props {
  questline: Questline;
  isOpen: boolean;
  onToggle: () => void;
  /** Open the right-side drawer to edit one of this questline's quests. */
  onEditQuest?: (questlineId: string, quest: Quest) => void;
}

export default function QuestlineAccordionItem({ questline, isOpen, onToggle, onEditQuest }: Props) {
  const deleteQuestline       = useQuestStore(s => s.deleteQuestline);
  const toggleQuestlineHidden = useQuestStore(s => s.toggleQuestlineHidden);
  const reorderQuests         = useQuestStore(s => s.reorderQuests);
  const deleteQuest           = useQuestStore(s => s.deleteQuest);
  const toggleQuestTracked    = useQuestStore(s => s.toggleQuestTracked);
  const editMode              = useUIStore(s => s.editMode);

  const [addingQuestTo,  setAddingQuestTo]  = useState<Quest | null>(null);
  const [addingNewQuest, setAddingNewQuest] = useState(false);
  const [editing,        setEditing]        = useState(false);
  const [headerHovered,  setHeaderHovered]  = useState(false);
  const [dragOverIndex,  setDragOverIndex]  = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

  const { done, total } = questlineProgress(questline);
  const isComplete = total > 0 && done === total;
  const activeQuest = getActiveQuest(questline);

  const sorted = [...questline.quests]
    .filter(q => editMode || !q.hidden)
    .sort((a, b) => a.order - b.order);

  function handleDrop(dropIdx: number) {
    if (dragIndex.current === null || dragIndex.current === dropIdx) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(dragIndex.current, 1);
    reordered.splice(dropIdx, 0, moved);
    reorderQuests(questline.id, reordered.map(q => q.id));
    dragIndex.current = null;
    setDragOverIndex(null);
  }

  // Hidden questline in edit mode — compact dimmed row
  if (questline.hidden && editMode) {
    return (
      <div className="parchment" style={{ borderRadius: 12, overflow: 'hidden', opacity: 0.4, borderTop: `2px solid ${categoryColor(questline.color)}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px' }}>
          <QuestIcon icon={questline.icon} size={22} />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--text-dim)', textDecoration: 'line-through' }}>
            {questline.title}
          </h2>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-dim)' }}>HIDDEN</span>
          <button onClick={() => toggleQuestlineHidden(questline.id)} title="Restore questline" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)', padding: '0 2px' }}>👁</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="parchment"
        style={{ borderRadius: 12, overflow: 'hidden', transition: 'box-shadow 0.3s', borderTop: `2px solid ${categoryColor(questline.color)}` }}
      >
        {/* ── Header ── */}
        <div
          onMouseEnter={() => setHeaderHovered(true)}
          onMouseLeave={() => setHeaderHovered(false)}
          onClick={onToggle}
          style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', cursor: 'pointer', userSelect: 'none' }}
        >
          <QuestIcon icon={questline.icon} size={28} style={{ flexShrink: 0 }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: '0 0 7px', fontSize: 15, fontWeight: 600,
              color: 'var(--text-parchment)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {questline.title}
            </h2>
            <ProgressBar done={done} total={total} color={questline.color} size="sm" showLabel={false} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {questline.recurring && (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '2px 8px' }}>
                {questline.recurring === 'daily' ? 'Daily' : questline.recurring === 'weekly' ? 'Weekly' : 'Monthly'}
              </span>
            )}
            {isComplete ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>✓ Complete</span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)' }}>{done}/{total}</span>
            )}

            {/* Always-available pencil to edit this questline's details */}
            <button
              onClick={e => { e.stopPropagation(); setEditing(true); }}
              title="Edit questline details"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1, transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              ✎
            </button>

            {editMode && headerHovered && (
              <>
                <button onClick={e => { e.stopPropagation(); toggleQuestlineHidden(questline.id); }} title="Hide questline" style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.5 }}>👁</button>
                <button onClick={e => { e.stopPropagation(); deleteQuestline(questline.id); }} title="Delete questline" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: 0, opacity: 0.7 }}>✕</button>
              </>
            )}

            <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3, ease: 'easeInOut' }} style={{ color: 'var(--text-dim)', fontSize: 11, display: 'inline-block' }}>▼</motion.span>
          </div>
        </div>

        {/* ── Expanded body ── */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ padding: '0 22px 22px' }}>
                <div className="rune-divider" style={{ marginBottom: 16 }}>
                  {editMode ? 'Quests' : isComplete ? 'Complete' : activeQuest ? 'Active quest' : 'Quests'}
                </div>

                {/* ── Edit mode: draggable quest list ── */}
                {editMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                    {sorted.length === 0 && (
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>No quests yet.</p>
                    )}
                    {sorted.map((quest, i) => {
                      const complete = isQuestComplete(quest);
                      const isHiddenInEdit = !!quest.hidden;
                      const isDragOver = dragOverIndex === i;

                      return (
                        <div
                          key={quest.id}
                          draggable
                          onDragStart={() => { dragIndex.current = i; }}
                          onDragOver={e => { e.preventDefault(); setDragOverIndex(i); }}
                          onDrop={() => handleDrop(i)}
                          onDragEnd={() => { dragIndex.current = null; setDragOverIndex(null); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px',
                            background: isDragOver ? 'var(--accent-soft)' : 'var(--input-bg)',
                            borderRadius: 8,
                            border: isDragOver ? '1px solid var(--accent-border)' : '1px solid var(--card-border)',
                            opacity: isHiddenInEdit ? 0.35 : 1,
                            cursor: 'grab',
                            transition: 'background 0.12s, border-color 0.12s',
                          }}
                        >
                          <span style={{ fontSize: 14, color: 'var(--text-dim)', cursor: 'grab', flexShrink: 0, userSelect: 'none', lineHeight: 1 }} title="Drag to reorder">⠿</span>

                          <span style={{
                            flex: 1, fontSize: 13, fontWeight: 500,
                            color: complete ? 'var(--text-dim)' : 'var(--text-parchment)',
                            textDecoration: (complete && !quest.recurring) || isHiddenInEdit ? 'line-through' : 'none',
                          }}>
                            {cleanQuest(quest.title)}
                          </span>

                          {isHiddenInEdit ? (
                            <>
                              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-dim)' }}>HIDDEN</span>
                              <button onClick={() => useQuestStore.getState().toggleQuestHidden(questline.id, quest.id)} title="Restore quest" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)', padding: '0 2px' }}>👁</button>
                            </>
                          ) : (
                            <>
                              {quest.recurring && (
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)' }}>
                                  {quest.recurring === 'daily' ? 'Daily' : quest.recurring === 'weekly' ? 'Weekly' : 'Monthly'}
                                </span>
                              )}
                              {complete && !quest.recurring && (
                                <span style={{ fontSize: 11, color: 'var(--success)' }}>✓</span>
                              )}
                              <button className="btn-ghost" onClick={() => setAddingQuestTo(quest)} style={{ fontSize: 11, padding: '3px 8px' }}>+ Task</button>
                              <PinButton
                                state={quest.trackedToday ? 'all' : 'none'}
                                hovered
                                onClick={() => toggleQuestTracked(questline.id, quest.id)}
                                title={questPinTitle(quest)}
                              />
                              <EditPencil onClick={() => onEditQuest?.(questline.id, quest)} />
                              <button onClick={() => useQuestStore.getState().toggleQuestHidden(questline.id, quest.id)} title="Hide quest" style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10, padding: '0 2px', opacity: 0.5 }}>👁</button>
                              <DeleteQuestX onClick={() => deleteQuest(questline.id, quest.id)} />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // ── Normal mode: active quest + compact others ──
                  <>
                    {isComplete && (
                      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--success)', padding: '8px 0 16px' }}>
                        All quests complete.
                      </p>
                    )}

                    {activeQuest && (
                      <div style={{ background: 'var(--input-bg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '16px 18px', marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, color: categoryColor(questline.color) }}>
                            {cleanQuest(activeQuest.title)}
                          </h3>
                          {/* Pin the whole quest to Today as a single tracked item. */}
                          <PinButton
                            state={activeQuest.trackedToday ? 'all' : 'none'}
                            hovered
                            label="Pin"
                            onClick={() => toggleQuestTracked(questline.id, activeQuest.id)}
                            title={questPinTitle(activeQuest)}
                          />
                          <EditPencil onClick={() => onEditQuest?.(questline.id, activeQuest)} />
                          <DeleteQuestX onClick={() => deleteQuest(questline.id, activeQuest.id)} />
                        </div>
                        {activeQuest.actions.filter(a => !a.hidden).length > 0 && (
                          <>
                            <div style={{ marginBottom: 10 }}>
                              <ProgressBar done={questProgress(activeQuest).done} total={questProgress(activeQuest).total} color={questline.color} size="sm" showLabel={false} />
                            </div>
                            {activeQuest.actions.filter(a => !a.hidden).map(action => (
                              <ActionItem key={action.id} action={action} questlineId={questline.id} questId={activeQuest.id} locked={false} />
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {sorted.length > 1 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                        {sorted.filter(q => q.id !== activeQuest?.id).map(quest => (
                          <CompactQuestRow
                            key={quest.id}
                            questline={questline}
                            quest={quest}
                            locked={!isQuestUnlocked(questline, quest)}
                            onEditQuest={onEditQuest}
                            onDelete={() => deleteQuest(questline.id, quest.id)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Footer */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {editMode && (
                    <button className="btn-ghost" onClick={() => setAddingNewQuest(true)} style={{ fontSize: 12 }}>+ New Quest</button>
                  )}
                  <Link to={`/questline/${questline.id}`} style={{ textDecoration: 'none' }}>
                    <button className="btn-gold" style={{ fontSize: 12 }}>Open questline →</button>
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {addingQuestTo && (
        <AddModal mode={{ type: 'action', questlineId: questline.id, questId: addingQuestTo.id }} onClose={() => setAddingQuestTo(null)} />
      )}
      {addingNewQuest && (
        <AddModal mode={{ type: 'quest', questlineId: questline.id }} onClose={() => setAddingNewQuest(false)} />
      )}
      {editing && (
        <EditQuestlineModal questline={questline} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
