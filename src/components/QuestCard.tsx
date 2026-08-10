import { useState, useRef, useEffect } from 'react';
import type { Quest, Questline, RecurringType } from '../types';
import {
  isQuestComplete, isQuestUnlocked, isCycleComplete,
  questProgress, getResetDisplay, getDueDateInfo,
  useQuestStore, useUIStore,
} from '../store';
import ProgressBar from './ProgressBar';
import ActionItem from './ActionItem';
import AddModal from './AddModal';
import QuestDoneToggle from './QuestDoneToggle';
import { categoryColor, cleanQuest } from '../lib/ui';

interface Props { quest: Quest; questline: Questline; }

const URGENCY_COLOR = { ok: 'var(--text-dim)', soon: '#d97706', urgent: 'var(--danger)', overdue: 'var(--danger)' };
const RECUR_LABEL: Record<RecurringType, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export default function QuestCard({ quest, questline }: Props) {
  const deleteQuest       = useQuestStore(s => s.deleteQuest);
  const setQuestRecurring = useQuestStore(s => s.setQuestRecurring);
  const setQuestDueDate   = useQuestStore(s => s.setQuestDueDate);
  const toggleQuestHidden = useQuestStore(s => s.toggleQuestHidden);
  const updateQuestTitle  = useQuestStore(s => s.updateQuestTitle);
  const editMode          = useUIStore(s => s.editMode);
  const [addingAction, setAddingAction] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editingTitle) titleInputRef.current?.select(); }, [editingTitle]);

  function startTitleEdit() {
    setTitleDraft(cleanQuest(quest.title));
    setEditingTitle(true);
  }
  function commitTitleEdit() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== cleanQuest(quest.title)) updateQuestTitle(questline.id, quest.id, trimmed);
    setEditingTitle(false);
  }

  const locked        = !isQuestUnlocked(questline, quest);
  const complete      = isQuestComplete(quest);
  const cycleComplete = isCycleComplete(quest);
  const { done, total } = questProgress(quest);
  const actionsVisible  = !locked || editMode;

  const dueInfo = quest.dueDate ? getDueDateInfo(quest.dueDate) : null;
  const streak  = quest.streak ?? 0;

  // Hidden quest in edit mode: compact dimmed row with restore
  if (quest.hidden && editMode) {
    return (
      <div
        className="parchment"
        style={{ borderRadius: 10, padding: '12px 18px', opacity: 0.35, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `2px solid ${categoryColor(questline.color)}` }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textDecoration: 'line-through' }}>
          {cleanQuest(quest.title)}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-dim)' }}>HIDDEN</span>
          <button
            onClick={() => toggleQuestHidden(questline.id, quest.id)}
            title="Restore quest"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)', padding: '0 2px' }}
          >
            👁
          </button>
        </div>
      </div>
    );
  }

  const renderedActions = editMode ? quest.actions : quest.actions.filter(a => !a.hidden);

  return (
    <>
      <div
        className="parchment"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          borderRadius: 10, padding: '20px 22px', position: 'relative',
          opacity: locked && !editMode ? 0.55 : locked ? 0.75 : 1,
          transition: 'opacity 0.3s, box-shadow 0.3s',
          borderTop: `2px solid ${categoryColor(questline.color)}`,
        }}
      >
        {/* ── Top-right badges ── */}
        <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          {quest.recurring && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {streak > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316', background: 'rgba(249,115,22,0.1)', borderRadius: 5, padding: '2px 7px' }}>
                  🔥 {streak}
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '2px 7px' }}>
                {RECUR_LABEL[quest.recurring]}
              </span>
            </div>
          )}
          {complete && !quest.recurring && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', background: 'rgba(52,211,153,0.1)', borderRadius: 5, padding: '2px 7px' }}>
              ✓ Done
            </span>
          )}
          {cycleComplete && (
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)' }}>✓ This cycle</span>
          )}
          {locked && <span style={{ fontSize: 13, opacity: 0.55 }}>🔒</span>}
        </div>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, paddingRight: 72 }}>
          {/* Locked quests already show a padlock among the top-right badges, so
              the toggle sits this one out rather than repeating it. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            {!locked && <QuestDoneToggle questlineId={questline.id} quest={quest} />}
            {editingTitle ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={commitTitleEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitTitleEdit(); if (e.key === 'Escape') setEditingTitle(false); }}
                style={{
                  flex: 1, fontSize: 15, fontWeight: 600, lineHeight: 1.4,
                  background: 'var(--input-bg)', border: '1px solid var(--accent-border)',
                  borderRadius: 6, color: 'var(--page-text)', padding: '2px 6px', outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            ) : (
              <h3
                onDoubleClick={startTitleEdit}
                title="Double-click to rename"
                style={{
                  margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.4,
                  color: (complete && !quest.recurring) || locked ? 'var(--text-dim)' : 'var(--page-text)',
                  textDecoration: complete && !quest.recurring ? 'line-through' : 'none',
                  cursor: 'text',
                }}
              >
                {cleanQuest(quest.title)}
              </h3>
            )}
          </div>
          {editMode && hovered && (
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingLeft: 8 }}>
              <button
                onClick={() => toggleQuestHidden(questline.id, quest.id)}
                title="Hide quest"
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.5 }}
              >
                👁
              </button>
              {!complete && (
                <button
                  onClick={() => deleteQuest(questline.id, quest.id)}
                  title="Delete quest"
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '0 0 0 4px', flexShrink: 0, opacity: 0.7 }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {quest.description && (
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            {quest.description}
          </p>
        )}

        {/* ── Due date ── */}
        {dueInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: URGENCY_COLOR[dueInfo.urgency] }}>
              {dueInfo.text}
            </span>
            {dueInfo.urgency === 'overdue' && (
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', background: 'rgba(248,113,113,0.1)', borderRadius: 4, padding: '1px 6px' }}>OVERDUE</span>
            )}
          </div>
        )}

        {total > 0 && (
          <div style={{ marginBottom: 14 }}>
            <ProgressBar done={done} total={total} color={questline.color} size="sm" />
          </div>
        )}

        {cycleComplete && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 10px' }}>
            {quest.recurring && getResetDisplay(quest)}
          </p>
        )}

        {/* ── Tasks ── */}
        {actionsVisible && (
          <div>
            {renderedActions.length === 0 && editMode && (
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>No tasks yet.</p>
            )}
            {renderedActions.map(action => (
              <ActionItem
                key={action.id}
                action={action}
                questlineId={questline.id}
                questId={quest.id}
                locked={locked}
                parentRecurring={!!quest.recurring}
              />
            ))}
            {editMode && !complete && (
              <button className="btn-ghost" onClick={() => setAddingAction(true)} style={{ marginTop: 12, fontSize: 12 }}>
                + Add Task
              </button>
            )}
          </div>
        )}

        {locked && !editMode && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
            Complete the previous quest to unlock.
          </p>
        )}

        {/* ── Edit-mode controls ── */}
        {editMode && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--card-border)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Repeats:</span>
              {([null, 'daily', 'weekly', 'monthly'] as const).map(r => (
                <button
                  key={String(r)}
                  onClick={() => setQuestRecurring(questline.id, quest.id, r)}
                  style={{
                    fontFamily: 'inherit', fontSize: 11, fontWeight: 500,
                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                    border: quest.recurring === r ? '1px solid var(--accent)' : '1px solid var(--card-border)',
                    background: quest.recurring === r ? 'var(--accent-soft)' : 'transparent',
                    color: quest.recurring === r ? 'var(--accent)' : 'var(--text-dim)',
                  }}
                >
                  {r === null ? 'Once' : RECUR_LABEL[r]}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>Due:</span>
              <input
                type="date"
                value={quest.dueDate ?? ''}
                onChange={e => setQuestDueDate(questline.id, quest.id, e.target.value || null)}
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--card-border)',
                  borderRadius: 6,
                  color: 'var(--page-text)',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  padding: '3px 6px',
                  cursor: 'pointer',
                }}
              />
              {quest.dueDate && (
                <button
                  onClick={() => setQuestDueDate(questline.id, quest.id, null)}
                  title="Clear due date"
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11 }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {addingAction && (
        <AddModal mode={{ type: 'action', questlineId: questline.id, questId: quest.id }} onClose={() => setAddingAction(false)} />
      )}
    </>
  );
}
