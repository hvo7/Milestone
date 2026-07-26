import { useState, useRef, useEffect } from 'react';
import type { Action, RecurringType } from '../types';
import { useQuestStore, useUIStore } from '../store';
import PinButton from './PinButton';

interface Props {
  action: Action;
  questlineId: string;
  questId: string;
  locked: boolean;
  parentRecurring?: boolean;
}

const RECUR_LABEL: Record<RecurringType, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export default function ActionItem({ action, questlineId, questId, locked, parentRecurring }: Props) {
  const toggleAction       = useQuestStore(s => s.toggleAction);
  const toggleTracked      = useQuestStore(s => s.toggleTracked);
  const deleteAction       = useQuestStore(s => s.deleteAction);
  const setActionRecurring = useQuestStore(s => s.setActionRecurring);
  const toggleActionHidden = useQuestStore(s => s.toggleActionHidden);
  const updateActionTitle  = useQuestStore(s => s.updateActionTitle);
  const editMode           = useUIStore(s => s.editMode);
  const [hovered, setHovered] = useState(false);
  const [showRecur, setShowRecur] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  function startEdit() {
    setTitleDraft(action.title);
    setEditingTitle(true);
  }

  function commitEdit() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== action.title) updateActionTitle(questlineId, questId, action.id, trimmed);
    setEditingTitle(false);
  }

  function cancelEdit() {
    setEditingTitle(false);
  }

  const canSetRecurring = editMode && !parentRecurring && !locked;

  // Hidden in edit mode: compact dimmed row with restore
  if (action.hidden && editMode) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', opacity: 0.35, borderBottom: '1px solid var(--card-border)' }}>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-dim)', textDecoration: 'line-through' }}>
          {action.title}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-dim)' }}>HIDDEN</span>
        <button
          onClick={() => toggleActionHidden(questlineId, questId, action.id)}
          title="Restore task"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)', padding: '0 2px' }}
        >
          👁
        </button>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowRecur(false); }}
      style={{ borderBottom: '1px solid var(--card-border)', opacity: locked ? 0.4 : 1 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
        <input
          type="checkbox"
          className="rune-check"
          checked={action.completed}
          disabled={locked}
          onChange={() => toggleAction(questlineId, questId, action.id)}
        />

        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
            style={{
              flex: 1, fontSize: 14,
              background: 'var(--input-bg)', border: '1px solid var(--accent-border)',
              borderRadius: 6, color: 'var(--text-parchment)', padding: '2px 6px', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            onClick={editMode && !locked ? startEdit : undefined}
            style={{
              flex: 1, fontSize: 14,
              color: action.completed ? 'var(--text-dim)' : 'var(--text-parchment)',
              textDecoration: action.completed ? 'line-through' : 'none',
              transition: 'color 0.3s', lineHeight: 1.4,
              cursor: editMode && !locked ? 'text' : 'default',
            }}
          >
            {action.title}
          </span>
        )}

        {/* Recurring badge */}
        {action.recurring && !editMode && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 4, padding: '1px 6px' }} title={`Resets ${action.recurring}`}>
            {RECUR_LABEL[action.recurring]}
          </span>
        )}

        {/* Recurring toggle button in edit mode */}
        {canSetRecurring && (
          <button
            onClick={() => setShowRecur(v => !v)}
            title="Set repeat"
            style={{
              background: action.recurring ? 'var(--accent-soft)' : 'none',
              border: action.recurring ? '1px solid var(--accent-border)' : '1px solid transparent',
              color: action.recurring ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
              opacity: action.recurring ? 1 : hovered ? 0.7 : 0,
              transition: 'opacity 0.2s',
              fontFamily: 'inherit',
            }}
          >
            {action.recurring ? RECUR_LABEL[action.recurring] : 'Repeat'}
          </button>
        )}

        {/* Pin to Today — available in edit mode too, since deciding what to work
            on next is exactly what you're doing while shaping a questline. */}
        {!locked && (
          <PinButton
            state={action.trackedToday ? 'all' : 'none'}
            hovered={hovered}
            onClick={() => toggleTracked(questlineId, questId, action.id)}
            title={action.trackedToday
              ? 'Pinned to Today — click to remove'
              : 'Pin to Today (adds it to your To Do list)'}
          />
        )}

        {/* Hide (edit mode, hovered) */}
        {editMode && hovered && !locked && (
          <button
            onClick={() => toggleActionHidden(questlineId, questId, action.id)}
            title="Hide task"
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.5 }}
          >
            👁
          </button>
        )}

        {/* Delete (edit mode, hovered) */}
        {editMode && hovered && !locked && (
          <button
            onClick={() => deleteAction(questlineId, questId, action.id)}
            title="Delete task"
            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '0 2px', opacity: 0.7 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Inline repeat picker */}
      {showRecur && canSetRecurring && (
        <div style={{ display: 'flex', gap: 6, paddingBottom: 8, paddingLeft: 28 }}>
          {([null, 'daily', 'weekly', 'monthly'] as const).map(r => (
            <button
              key={String(r)}
              onClick={() => { setActionRecurring(questlineId, questId, action.id, r); setShowRecur(false); }}
              style={{
                fontFamily: 'inherit', fontSize: 11, fontWeight: 500,
                padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                border: action.recurring === r ? '1px solid var(--accent)' : '1px solid var(--card-border)',
                background: action.recurring === r ? 'var(--accent-soft)' : 'transparent',
                color: action.recurring === r ? 'var(--accent)' : 'var(--text-dim)',
              }}
            >
              {r === null ? 'Once' : RECUR_LABEL[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
