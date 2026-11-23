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
import { automaticOrder } from '../lib/completionOrder';
import { questShowsOnDay } from '../lib/today';
import { logicalDateKey } from '../domain/schedule';
import { cleanQuest } from '../lib/ui';
import { questlineMomentum, movedLabel, etaLabel, etaChip, quietSignal, momentumHex, STATE_LABEL, MOMENTUM_WINDOW_DAYS } from '../lib/momentum';
import { questlineArt } from '../lib/questComplete';
import { motionSeconds } from '../lib/motion';
import Icon from './Icon';
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

/**
 * A quest other than the active one: a compact row that expands to reveal its
 * tasks, so any task can be checked off or pinned to Today without leaving the
 * Quests tab. Previously these rows were closed surfaces — only the active
 * quest showed its tasks, so everything else could only be pinned by opening
 * the questline's own page.
 */
function CompactQuestRow({ questline, quest, locked, active = false, drag, registerRow, dragging, shiftY, onEditQuest, onDelete }: {
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
  const completedLast = questline.sortMode !== 'manual';
  const visibleActions = quest.actions.filter(a => !a.hidden);
  const actions = completedLast ? automaticOrder(visibleActions, a => a.completed) : visibleActions;
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
      className="quest-row"
      data-state={complete ? 'done' : locked ? 'locked' : active ? 'current' : 'open'}
      data-dragging={dragging ? true : undefined}
      style={{
        boxShadow: dragging ? 'var(--shadow-pop)' : undefined,
        zIndex: dragging ? 5 : undefined,
        position: dragging ? 'relative' : undefined,
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
        style={{ cursor: canExpand ? 'pointer' : 'default', userSelect: 'none' }}
      >
        <QuestDoneToggle questlineId={questline.id} quest={quest} locked={locked} />
        <span className="quest-mobile-title quest-row-title">
          <EditTitle reorderHandle={!completedLast} onEdit={() => onEditQuest?.(questline.id, quest)}>{cleanQuest(quest.title)}</EditTitle>
        </span>

        {quest.recurring && (
          <span className="quest-row-count">
            {quest.recurring === 'daily' ? 'Daily' : quest.recurring === 'weekly' ? 'Weekly' : 'Monthly'}
          </span>
        )}
        {at > 0 && <span className="quest-row-count">{ad} of {at}</span>}

        {!locked && (
          <PinButton
            state={pinned ? 'all' : 'none'}
            hovered={hovered}
            onClick={() => toggleQuestTracked(questline.id, quest.id)}
            title={questPinTitle(quest)}
          />
        )}
        <button type="button" className="icon-btn-round quest-row-delete" aria-label="Delete quest" title="Delete quest"
          onClick={e => { e.stopPropagation(); onDelete(); }}><Icon name="close" size={14} /></button>
      </div>

      <AnimatePresence initial={false}>
        {(active || expanded) && canExpand && (
          <motion.div
            key="tasks"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: motionSeconds('expand'), ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="quest-row-steps">
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
              {!locked && <button type="button" className="btn-quiet quest-add-step" onClick={() => setAddingStep(true)}><Icon name="plus" size={14} />Add step</button>}
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
  const completedLast = questline.sortMode !== 'manual';

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

  const manualOrder = [...questline.quests]
    .filter(q => !q.hidden)
    .sort((a, b) => a.order - b.order);
  const sorted = completedLast ? automaticOrder(questline.quests.filter(q => !q.hidden), isQuestComplete) : manualOrder;
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
    if (completedLast) return;
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
      <div className="parchment" style={{ borderRadius: 12, overflow: 'hidden', opacity: 0.4, }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px' }}>
          <QuestArtwork kind="questline" title={questline.title} id={questline.id} icon={questline.icon} size={22} />
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--text-dim)', textDecoration: 'line-through' }}>
            {questline.title}
          </h2>
          <span className="quest-row-count">Hidden</span>
          <button type="button" className="btn-quiet" onClick={() => toggleQuestlineHidden(questline.id)}>Restore</button>
        </div>
      </div>
    );
  }

  const signal = quietSignal(momentum);
  const eta30 = etaChip(momentum.pace);

  return (
    <>
      <div
        className={detail ? 'questline-panel' : 'parchment'}
        style={detail ? undefined : { overflow: 'hidden' }}
      >
        {/* ── Header ── */}
        {detail ? (
          <header className="questline-panel-head">
            <div className="questline-panel-title">
              <img className="questline-panel-art" src={questlineArt(questline)} alt="" width={64} height={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2><EditTitle onEdit={() => setEditing(true)}>{questline.title}</EditTitle></h2>
                <div className="momentum-chips">
                  <span className="momentum-chip" data-tone={signal.tone}>{signal.text}</span>
                  <span className="momentum-chip">{momentum.movement.moves} {momentum.movement.moves === 1 ? 'task' : 'tasks'} in {MOMENTUM_WINDOW_DAYS} days</span>
                  {eta30 && <span className="momentum-chip">{eta30}</span>}
                  {questline.sequential && <span className="momentum-chip">Sequential</span>}
                  {questline.recurring && <span className="momentum-chip">
                    {questline.recurring === 'daily' ? 'Daily' : questline.recurring === 'weekly' ? 'Weekly' : 'Monthly'}</span>}
                  {questline.targetDate && <span className="momentum-chip">Target {new Date(`${questline.targetDate}T12:00:00`).toLocaleDateString()}</span>}
                </div>
              </div>
              <button type="button" className="icon-btn-round" aria-label="Edit questline" title="Edit questline" onClick={() => setEditing(true)}><Icon name="edit" size={16} /></button>
              <button type="button" className="icon-btn-round quest-row-delete" aria-label="Delete questline" title="Delete questline" onClick={() => deleteQuestline(questline.id)}><Icon name="trash" size={16} /></button>
            </div>
            <div className="questline-panel-progress">
              <div className="progress-track" role="progressbar" aria-label="Quests complete" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
                <div className="progress-fill" style={{ width: `${total ? Math.round(100 * done / total) : 0}%` }} />
              </div>
              <span>{done} of {total}</span>
            </div>
          </header>
        ) : (
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
        )}

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
              <div style={{ padding: detail ? 0 : '0 22px 22px' }}>
                {detail && questline.description && <p className="questline-description">{questline.description}</p>}
                {!detail && <div className="rune-divider" style={{ marginBottom: 16 }}>
                  {editMode ? 'Quests' : isComplete ? 'Complete' : activeQuest ? 'Active quest' : 'Quests'}
                </div>}

                {/* ── Edit mode: draggable quest list ── */}
                {editMode ? (
                  <div className="quest-rows">
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
                          data-quest-row={quest.id}
                          draggable={!completedLast}
                          onDragStart={e => { if (completedLast) { e.preventDefault(); return; } dragIndex.current = i; }}
                          onDragOver={e => { if (completedLast) return; e.preventDefault(); setDragOverIndex(i); }}
                          onDrop={() => handleDrop(i)}
                          onDragEnd={() => { dragIndex.current = null; setDragOverIndex(null); }}
                          className="quest-row quest-row-edit"
                          data-drop={isDragOver || undefined}
                          style={{ opacity: isHiddenInEdit ? 0.45 : 1, cursor: completedLast ? 'default' : 'grab' }}
                        >
                          {!completedLast && <span style={{ color: 'var(--ink-dim)', cursor: 'grab', flexShrink: 0 }} title="Drag to reorder"><Icon name="grip" size={16} /></span>}

                          {/* Edit mode was the one surface on this tab where a quest
                              could be renamed, moved, hidden and deleted but not
                              finished — you had to leave edit mode to tick it. The
                              sequential gate is ignored here on purpose: edit mode is
                              where you fix the list, including a quest that was
                              actually done before the one ahead of it. */}
                          {!isHiddenInEdit && (
                            <QuestDoneToggle questlineId={questline.id} quest={quest} />
                          )}

                          <span style={{
                            flex: 1, fontSize: 13, fontWeight: 500,
                            color: complete ? 'var(--text-dim)' : 'var(--text-parchment)',
                            textDecoration: (complete && !quest.recurring) || isHiddenInEdit ? 'line-through' : 'none',
                          }}>
                            <EditTitle onEdit={() => onEditQuest?.(questline.id, quest)}>{cleanQuest(quest.title)}</EditTitle>
                          </span>

                          {isHiddenInEdit ? (
                            <>
                              <span className="quest-row-count">Hidden</span>
                              <button type="button" className="btn-quiet" onClick={() => useQuestStore.getState().toggleQuestHidden(questline.id, quest.id)}>Restore</button>
                            </>
                          ) : (
                            <>
                              {quest.recurring && (
                                <span className="quest-row-count">
                                  {quest.recurring === 'daily' ? 'Daily' : quest.recurring === 'weekly' ? 'Weekly' : 'Monthly'}
                                </span>
                              )}
                              {/* The ✓ that used to sit here said what the checkbox
                                  now shows, one control to its left. */}
                              <button type="button" className="btn-quiet" onClick={() => setAddingQuestTo(quest)}>Add step</button>
                              <PinButton
                                state={questShowsOnDay(quest, logicalDateKey()) ? 'all' : 'none'}
                                hovered
                                onClick={() => toggleQuestTracked(questline.id, quest.id)}
                                title={questPinTitle(quest)}
                              />
                              <button type="button" className="icon-btn-round quest-row-delete" aria-label="Delete quest" title="Delete quest"
                                onClick={() => deleteQuest(questline.id, quest.id)}><Icon name="close" size={14} /></button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // ── Normal mode: active quest + compact others ──
                  <>
                    {isComplete && !detail && (
                      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--success)', padding: '8px 0 16px' }}>
                        All quests complete.
                      </p>
                    )}
                    {detail && sorted.length === 0 && <p className="empty-state" style={{ background: 'var(--sunken)' }}>No quests yet.</p>}

                    {sorted.length > 0 && (
                      <div className="quest-rows">
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
                                drag={completedLast ? { onPointerDown: () => {}, onClickCapture: () => {} } : hold.rowProps(quest.id, i)}
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
