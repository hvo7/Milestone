import { useCallback, useEffect, useRef, useState } from 'react';
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
import QuestArtwork from './QuestArtwork';
import PinButton from './PinButton';
import QuestDoneToggle from './QuestDoneToggle';
import EditTitle from './EditTitle';
import { questShowsOnDay } from '../lib/today';
import { logicalDateKey } from '../domain/schedule';
import { categoryColor, cleanQuest } from '../lib/ui';
import { questlineMomentum, movedLabel, etaLabel, momentumHex, STATE_LABEL } from '../lib/momentum';
import { useHoldToReorder, type HoldReorder, type RowHandlers } from '../lib/useHoldToReorder';

/** Tooltip for the quest-level pin. Pinning puts the quest on the Today list as a
 *  single item, with its tasks (if any) as check-off steps beneath it. */
function questPinTitle(quest: Quest): string {
  if (questShowsOnDay(quest, logicalDateKey())) return 'Pinned to Today — click to unpin';
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

/**
 * A quest other than the active one: a compact row that expands to reveal its
 * tasks, so any task can be checked off or pinned to Today without leaving the
 * Quests tab. Previously these rows were closed surfaces — only the active
 * quest showed its tasks, so everything else could only be pinned by opening
 * the questline's own page.
 */
function CompactQuestRow({ questline, quest, locked, subdued, active = false, drag, registerRow, dragging, shiftY, onEditQuest, onDelete }: {
  questline: Questline;
  quest: Quest;
  locked: boolean;
  /** Dimmed slightly because an active-quest card above it holds the focus. When
   *  these rows *are* the whole list (a flexible questline) they render at full
   *  strength instead. */
  subdued: boolean;
  active?: boolean;
  /** Hold-to-reorder handlers for this row, from `useHoldToReorder`. */
  drag: RowHandlers;
  /** Reports this row's element to the reorder hook so it can measure the list. */
  registerRow: HoldReorder['registerRow'];
  /** This row is the one currently lifted — it rides the pointer. */
  dragging: { offsetY: number } | null;
  shiftY: number;
  onEditQuest?: (questlineId: string, quest: Quest) => void;
  onDelete: () => void;
}) {
  const toggleQuestTracked = useQuestStore(s => s.toggleQuestTracked);
  const [hovered, setHovered]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    registerRow(quest.id, rowRef.current);
    return () => registerRow(quest.id, null);
  }, [quest.id, registerRow]);

  const complete = isQuestComplete(quest);
  const { done: ad, total: at } = questProgress(quest);
  const actions = quest.actions.filter(a => !a.hidden);
  const pinned = questShowsOnDay(quest, logicalDateKey());
  const canExpand = true;

  return (
    <motion.div
      layout="position"
      animate={{ y: dragging?.offsetY ?? shiftY, scale: dragging ? 1.015 : 1 }}
      transition={{ y: { duration: dragging ? 0 : 0.18 }, scale: { duration: 0.15 }, layout: { duration: 0.2 } }}
      data-quest-row={quest.id}
      data-reorder-offset={shiftY}
      ref={rowRef}
      style={{
        background: 'var(--input-bg)',
        borderRadius: 8,
        border: `1px solid ${dragging ? 'var(--accent)' : pinned ? 'var(--accent-border)' : 'var(--card-border)'}`,
        opacity: dragging ? 1 : locked ? 0.5 : subdued ? 0.9 : 1,
        overflow: 'hidden',
        // The lifted row follows the pointer above its neighbours; everything else
        // eases back into place as the list settles.
        boxShadow: dragging ? '0 10px 24px rgba(0,0,0,0.45)' : undefined,
        zIndex: dragging ? 5 : undefined,
        position: dragging ? 'relative' : undefined,
        transition: 'border-color 0.18s',
        // Vertical panning stays with the scroller until a row actually lifts.
        touchAction: 'pan-y',
      }}
    >
      <div
        className="quest-mobile-row"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onPointerDown={drag.onPointerDown}
        onClickCapture={drag.onClickCapture}
        onClick={() => canExpand && setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: active ? '16px 18px' : '7px 12px', flexWrap: 'wrap',
          cursor: canExpand ? 'pointer' : 'default', userSelect: 'none',
        }}
      >
        <QuestDoneToggle questlineId={questline.id} quest={quest} locked={locked} small />
        <QuestArtwork kind="quest" title={quest.title} id={quest.id} context={questline.title} />
        <span className="quest-mobile-title" style={{
          flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0,
          color: complete ? 'var(--text-dim)' : active ? categoryColor(questline.color) : 'var(--text-parchment)',
          textDecoration: complete && !quest.recurring ? 'line-through' : 'none',
        }}>
          <EditTitle reorderHandle onEdit={() => onEditQuest?.(questline.id, quest)}>{cleanQuest(quest.title)}</EditTitle>
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
        <DeleteQuestX onClick={onDelete} />
      </div>

      <AnimatePresence initial={false}>
        {(active || expanded) && canExpand && (
          <motion.div
            key="tasks"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '2px 12px 6px 38px' }}>
              {active && at > 0 && <ProgressBar done={ad} total={at} color={questline.color} size="sm" showLabel={false} />}
              {quest.description && <p className="questline-description">{quest.description}</p>}
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
              {!locked && <button type="button" className="btn-ghost" onClick={() => setAddingStep(true)} style={{ fontSize: 12, margin: '8px 0' }}>＋ Add step</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {addingStep && <AddModal mode={{ type: 'action', questlineId: questline.id, questId: quest.id }} onClose={() => setAddingStep(false)} />}
    </motion.div>
  );
}

interface Props {
  questline: Questline;
  isOpen: boolean;
  onToggle: () => void;
  /** The selected questline stays open in the workspace's detail pane. */
  detail?: boolean;
  /** Open the right-side drawer to edit one of this questline's quests. */
  onEditQuest?: (questlineId: string, quest: Quest) => void;
}

export default function QuestlineAccordionItem({ questline, isOpen, onToggle, onEditQuest, detail = false }: Props) {
  const deleteQuestline       = useQuestStore(s => s.deleteQuestline);
  const toggleQuestlineHidden = useQuestStore(s => s.toggleQuestlineHidden);
  const reorderQuests         = useQuestStore(s => s.reorderQuests);
  const deleteQuest           = useQuestStore(s => s.deleteQuest);
  const toggleQuestTracked    = useQuestStore(s => s.toggleQuestTracked);
  const routines              = useQuestStore(s => s.routines);
  const taskHistory           = useQuestStore(s => s.taskHistory);
  const editMode              = useUIStore(s => s.editMode);

  const [addingQuestTo,  setAddingQuestTo]  = useState<Quest | null>(null);
  const [addingNewQuest, setAddingNewQuest] = useState(false);
  const [editing,        setEditing]        = useState(false);
  const [dragOverIndex,  setDragOverIndex]  = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

  const { done, total } = questlineProgress(questline);
  const isComplete = total > 0 && done === total;
  // The time axis the progress bar has never had: 3/11 reads the same whether the
  // last one landed yesterday or in March, and this is the half that says which.
  const momentum = questlineMomentum(questline, routines, taskHistory);
  const eta = etaLabel(momentum.pace);
  // Only a sequential questline has a genuinely singled-out quest — the one the
  // gate has opened. In a flexible questline every unlocked quest is equally
  // active, so hoisting one into a card (and dimming the rest) would invent a
  // hierarchy that doesn't exist; they all render as equal rows instead.
  const activeQuest = questline.sequential ? getActiveQuest(questline) : null;

  const sorted = [...questline.quests]
    .filter(q => !q.hidden)
    .sort((a, b) => a.order - b.order);
  // Preserve hidden quests in their existing slots while reordering all visible quests.
  const hold = useHoldToReorder(
    sorted.map(q => q.id),
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
          <QuestArtwork kind="questline" title={questline.title} id={questline.id} icon={questline.icon} size={22} />
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
          onClick={detail ? undefined : onToggle}
          style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px', cursor: detail ? 'default' : 'pointer', flexWrap: 'wrap' }}
        >
          <QuestArtwork kind="questline" title={questline.title} id={questline.id} icon={questline.icon} size={28} style={{ flexShrink: 0 }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{
              margin: '0 0 7px', fontSize: 15, fontWeight: 600,
              color: 'var(--text-parchment)',
              overflowWrap: 'anywhere',
            }}>
              <EditTitle onEdit={() => setEditing(true)}>{questline.title}</EditTitle>
            </h2>
            <ProgressBar done={done} total={total} color={questline.color} size="sm" showLabel={false} />
            {/* Only where it adds something. A finished questline needs no pace,
                and a brand-new one has no reading worth printing. */}
            {!detail && momentum.state !== 'done' && momentum.state !== 'idle' && (
              <div
                title={`This questline is ${STATE_LABEL[momentum.state]}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minWidth: 0 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 999, background: momentumHex(momentum.state), flexShrink: 0 }} />
                <span style={{
                  fontSize: 11, color: 'var(--text-dim)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {movedLabel(momentum.movement)}
                  {eta && <> · {eta}</>}
                </span>
              </div>
            )}
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

            <IconButton onClick={() => deleteQuestline(questline.id)} title="Delete questline" stopPropagation size={12} rest="var(--danger)" hover="var(--danger)">✕</IconButton>

            {!detail && <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.3, ease: 'easeInOut' }} style={{ color: 'var(--text-dim)', fontSize: 11, display: 'inline-block' }}>▼</motion.span>}
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
                {detail && questline.description && <p className="questline-description">{questline.description}</p>}
                {detail && questline.targetDate && <p className="questline-description">Target: {new Date(`${questline.targetDate}T12:00:00`).toLocaleDateString()}</p>}
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

                          {/* Edit mode was the one surface on this tab where a quest
                              could be renamed, moved, hidden and deleted but not
                              finished — you had to leave edit mode to tick it. The
                              sequential gate is ignored here on purpose: edit mode is
                              where you fix the list, including a quest that was
                              actually done before the one ahead of it. */}
                          {!isHiddenInEdit && (
                            <QuestDoneToggle questlineId={questline.id} quest={quest} small />
                          )}
                          <QuestArtwork kind="quest" title={quest.title} id={quest.id} context={questline.title} />

                          <span style={{
                            flex: 1, fontSize: 13, fontWeight: 500,
                            color: complete ? 'var(--text-dim)' : 'var(--text-parchment)',
                            textDecoration: (complete && !quest.recurring) || isHiddenInEdit ? 'line-through' : 'none',
                          }}>
                            <EditTitle onEdit={() => onEditQuest?.(questline.id, quest)}>{cleanQuest(quest.title)}</EditTitle>
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
                              {/* The ✓ that used to sit here said what the checkbox
                                  now shows, one control to its left. */}
                              <button className="btn-ghost" onClick={() => setAddingQuestTo(quest)} style={{ fontSize: 11, padding: '3px 8px' }}>+ Task</button>
                              <PinButton
                                state={questShowsOnDay(quest, logicalDateKey()) ? 'all' : 'none'}
                                hovered
                                onClick={() => toggleQuestTracked(questline.id, quest.id)}
                                title={questPinTitle(quest)}
                              />
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

                    {sorted.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                        {sorted.map((quest, i) => {
                          return (
                              <CompactQuestRow
                                key={quest.id}
                                shiftY={hold.offsetFor(quest.id)}
                                questline={questline}
                                quest={quest}
                                locked={!isQuestUnlocked(questline, quest)}
                                active={activeQuest?.id === quest.id}
                                subdued={!!activeQuest && activeQuest.id !== quest.id}
                                drag={hold.rowProps(quest.id, i)}
                                registerRow={hold.registerRow}
                                dragging={hold.dragId === quest.id ? { offsetY: hold.offsetY } : null}
                                onEditQuest={onEditQuest}
                                onDelete={() => deleteQuest(questline.id, quest.id)}
                              />
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* Footer */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {editMode && (
                    <button className="btn-ghost" onClick={() => setAddingNewQuest(true)} style={{ fontSize: 12 }}>+ New Quest</button>
                  )}
                  {!detail && <Link to={`/questline/${questline.id}`} style={{ textDecoration: 'none' }}>
                    <button className="btn-gold" style={{ fontSize: 12 }}>Open questline →</button>
                  </Link>}
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
