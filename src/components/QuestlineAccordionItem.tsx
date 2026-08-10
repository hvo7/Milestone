import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
import IconButton from './IconButton';
import ActionItem from './ActionItem';
import AddModal from './AddModal';
import EditQuestlineModal from './EditQuestlineModal';
import QuestIcon from './QuestIcon';
import PinButton from './PinButton';
import QuestDoneToggle from './QuestDoneToggle';
import { categoryColor, cleanQuest } from '../lib/ui';
import { useHoldToReorder, type HoldReorder, type RowHandlers } from '../lib/useHoldToReorder';

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
  // Quest rows are clickable (they expand), so row actions must not bubble.
  return <IconButton onClick={onClick} title={title} stopPropagation style={{ padding: '0 2px' }}>✎</IconButton>;
}

/** The red ✕ at the right edge of every quest row — one click deletes the quest
 *  (its tasks go with it; any linked Today routines are detached, not deleted). */
function DeleteQuestX({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <IconButton
      onClick={onClick} title="Delete quest" stopPropagation
      rest="var(--danger)" hover="var(--danger)" size={12} fade={0.65}
    >
      ✕
    </IconButton>
  );
}

/** Where a held row will land when released. */
function InsertionBar({ color }: { color: Questline['color'] }) {
  return (
    <div style={{
      height: 2, borderRadius: 2, margin: '-1px 0',
      background: categoryColor(color), boxShadow: `0 0 6px ${categoryColor(color)}`,
    }} />
  );
}

/**
 * A quest other than the active one: a compact row that expands to reveal its
 * tasks, so any task can be checked off or pinned to Today without leaving the
 * Quests tab. Previously these rows were closed surfaces — only the active
 * quest showed its tasks, so everything else could only be pinned by opening
 * the questline's own page.
 */
function CompactQuestRow({ questline, quest, locked, subdued, drag, registerRow, dragging, onEditQuest, onDelete }: {
  questline: Questline;
  quest: Quest;
  locked: boolean;
  /** Dimmed slightly because an active-quest card above it holds the focus. When
   *  these rows *are* the whole list (a flexible questline) they render at full
   *  strength instead. */
  subdued: boolean;
  /** Hold-to-reorder handlers for this row, from `useHoldToReorder`. */
  drag: RowHandlers;
  /** Reports this row's element to the reorder hook so it can measure the list. */
  registerRow: HoldReorder['registerRow'];
  /** This row is the one currently lifted — it rides the pointer. */
  dragging: { offsetY: number } | null;
  onEditQuest?: (questlineId: string, quest: Quest) => void;
  onDelete: () => void;
}) {
  const toggleQuestTracked = useQuestStore(s => s.toggleQuestTracked);
  const [hovered, setHovered]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    registerRow(quest.id, rowRef.current);
    return () => registerRow(quest.id, null);
  }, [quest.id, registerRow]);

  const complete = isQuestComplete(quest);
  const { done: ad, total: at } = questProgress(quest);
  const actions = quest.actions.filter(a => !a.hidden);
  const pinned = !!quest.trackedToday;
  const canExpand = actions.length > 0;

  return (
    <div
      ref={rowRef}
      style={{
        background: 'var(--input-bg)',
        borderRadius: 8,
        border: `1px solid ${dragging ? 'var(--accent)' : pinned ? 'var(--accent-border)' : 'var(--card-border)'}`,
        opacity: locked ? 0.5 : subdued ? 0.9 : 1,
        overflow: 'hidden',
        // The lifted row follows the pointer above its neighbours; everything else
        // eases back into place as the list settles.
        transform: dragging ? `translateY(${dragging.offsetY}px) scale(1.015)` : undefined,
        boxShadow: dragging ? '0 10px 24px rgba(0,0,0,0.45)' : undefined,
        zIndex: dragging ? 5 : undefined,
        position: dragging ? 'relative' : undefined,
        transition: dragging ? 'none' : 'border-color 0.18s, transform 0.18s',
        // Vertical panning stays with the scroller until a row actually lifts.
        touchAction: 'pan-y',
      }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onPointerDown={drag.onPointerDown}
        onClickCapture={drag.onClickCapture}
        onClick={() => canExpand && setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
          cursor: canExpand ? 'pointer' : 'default', userSelect: 'none',
        }}
      >
        <QuestDoneToggle questlineId={questline.id} quest={quest} locked={locked} small />
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
  // Only a sequential questline has a genuinely singled-out quest — the one the
  // gate has opened. In a flexible questline every unlocked quest is equally
  // active, so hoisting one into a card (and dimming the rest) would invent a
  // hierarchy that doesn't exist; they all render as equal rows instead.
  const activeQuest = questline.sequential ? getActiveQuest(questline) : null;

  const sorted = [...questline.quests]
    .filter(q => editMode || !q.hidden)
    .sort((a, b) => a.order - b.order);
  const otherQuests = sorted.filter(q => q.id !== activeQuest?.id);

  // Hold-to-reorder for the normal-mode list. The rendered rows are a filtered
  // view — hidden quests are absent, and a sequential questline's active quest is
  // hoisted into its own card above — so the reordered subset is spliced back into
  // the full order rather than sent as-is. (`reorderQuests` now preserves unnamed
  // quests too, but relying on that would silently move them to the end.)
  const hold = useHoldToReorder(
    otherQuests.map(q => q.id),
    useCallback((nextIds: string[]) => {
      const movable = new Set(nextIds);
      const queue = [...nextIds];
      const full = [...questline.quests].sort((a, b) => a.order - b.order);
      reorderQuests(questline.id, full.map(q => movable.has(q.id) ? queue.shift()! : q.id));
    }, [questline.id, questline.quests, reorderQuests]),
  );

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
            <IconButton onClick={() => setEditing(true)} title="Edit questline details" stopPropagation size={14} style={{ padding: '0 2px' }}>
              ✎
            </IconButton>

            {editMode && headerHovered && (
              <>
                <IconButton onClick={() => toggleQuestlineHidden(questline.id)} title="Hide questline" stopPropagation size={11} fade={0.5} style={{ padding: '0 2px' }}>👁</IconButton>
                <IconButton onClick={() => deleteQuestline(questline.id)} title="Delete questline" stopPropagation size={12} fade={0.7} rest="var(--danger)" hover="var(--danger)">✕</IconButton>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <QuestDoneToggle questlineId={questline.id} quest={activeQuest} />
                          <h3 style={{
                            margin: 0, fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0,
                            color: isQuestComplete(activeQuest) ? 'var(--text-dim)' : categoryColor(questline.color),
                            textDecoration: isQuestComplete(activeQuest) && !activeQuest.recurring ? 'line-through' : 'none',
                          }}>
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

                    {otherQuests.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                        {otherQuests.map((quest, i) => {
                          // Where this row sits once the lifted row is taken out —
                          // the coordinate space `hold.slot` is expressed in.
                          const dragIdx = otherQuests.findIndex(q => q.id === hold.dragId);
                          const reduced = dragIdx === -1 || i < dragIdx ? i : i - 1;
                          const showBar = hold.dragId !== null && quest.id !== hold.dragId;
                          return (
                            <Fragment key={quest.id}>
                              {showBar && hold.slot === reduced && <InsertionBar color={questline.color} />}
                              <CompactQuestRow
                                questline={questline}
                                quest={quest}
                                locked={!isQuestUnlocked(questline, quest)}
                                subdued={!!activeQuest}
                                drag={hold.rowProps(quest.id, i)}
                                registerRow={hold.registerRow}
                                dragging={hold.dragId === quest.id ? { offsetY: hold.offsetY } : null}
                                onEditQuest={onEditQuest}
                                onDelete={() => deleteQuest(questline.id, quest.id)}
                              />
                            </Fragment>
                          );
                        })}
                        {/* Dropping past the last row lands at slot n-1, which no
                            row's own index can match — draw that bar at the end. */}
                        {hold.dragId !== null && hold.slot === otherQuests.length - 1 && (
                          <InsertionBar color={questline.color} />
                        )}
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
