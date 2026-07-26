import { useState, useRef, useEffect } from 'react';
import type { Routine } from '../types';
import {
  isRoutineComplete, getResetDisplay,
  useQuestStore, useUIStore,
} from '../store';
import QuestIcon from './QuestIcon';
import { categoryColor, cleanQuest } from '../lib/ui';

interface Props { routine: Routine; }

export default function RoutineCard({ routine }: Props) {
  const toggleRoutine        = useQuestStore(s => s.toggleRoutine);
  const toggleRoutineTracked = useQuestStore(s => s.toggleRoutineTracked);
  const deleteRoutine        = useQuestStore(s => s.deleteRoutine);
  const toggleRoutineHidden  = useQuestStore(s => s.toggleRoutineHidden);
  const updateRoutineTitle   = useQuestStore(s => s.updateRoutineTitle);
  const setRoutineQuest      = useQuestStore(s => s.setRoutineQuest);
  const questlines           = useQuestStore(s => s.questlines);
  const editMode             = useUIStore(s => s.editMode);
  const [hovered, setHovered] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  function startEdit() {
    setTitleDraft(routine.title);
    setEditingTitle(true);
  }

  function commitEdit() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== routine.title) updateRoutineTitle(routine.id, trimmed);
    setEditingTitle(false);
  }

  function cancelEdit() {
    setEditingTitle(false);
  }

  const parentQuestline = routine.questlineId ? questlines.find(ql => ql.id === routine.questlineId) : null;
  const parentQuest = parentQuestline && routine.questId
    ? parentQuestline.quests.find(q => q.id === routine.questId) ?? null
    : null;
  const cleanQuestTitle = cleanQuest;

  function scrollToQuest(questId: string) {
    document.getElementById(`quest-${questId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const complete = isRoutineComplete(routine);
  const streak = routine.streak ?? 0;
  const accentHex = routine.recurring === 'daily' ? '#fbbf24' : '#60a5fa';
  const recurLabel = routine.recurring === 'daily' ? 'Daily' : 'Weekly';
  const isDaily = routine.recurring === 'daily';

  // Hidden in edit mode: compact dimmed row with restore
  if (routine.hidden && editMode) {
    return (
      <div
        className="parchment"
        style={{ borderRadius: 10, padding: '12px 18px', opacity: 0.35, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `2px solid ${accentHex}` }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-dim)', textDecoration: 'line-through' }}>
          {routine.title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--text-dim)' }}>HIDDEN</span>
          <button
            onClick={() => toggleRoutineHidden(routine.id)}
            title="Restore task"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-dim)', padding: '0 2px' }}
          >
            👁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="parchment"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 10, padding: '16px 18px', position: 'relative',
        borderTop: `2px solid ${accentHex}`,
        transition: 'box-shadow 0.3s',
      }}
    >
      {/* Top-right badges */}
      <div style={{ position: 'absolute', top: 12, right: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        {streak > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316', background: 'rgba(249,115,22,0.1)', borderRadius: 5, padding: '2px 7px' }}>
            🔥 {streak}
          </span>
        )}
        <span style={{ fontSize: 11, fontWeight: 600, color: accentHex, background: `${accentHex}1a`, borderRadius: 5, padding: '2px 7px' }}>
          {recurLabel}
        </span>
      </div>

      {/* Questline + connected-quest badge */}
      {parentQuestline && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <QuestIcon icon={parentQuestline.icon} size={14} />
            <span style={{ fontSize: 11, fontWeight: 600, color: categoryColor(parentQuestline.color) }}>
              {parentQuestline.title}
            </span>
          </div>
          {parentQuest && (
            <button
              onClick={() => scrollToQuest(parentQuest.id)}
              title="Jump to connected quest"
              style={{
                marginTop: 4, marginLeft: 1, display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 11, color: 'var(--text-dim)', fontFamily: 'inherit',
              }}
            >
              <span style={{ opacity: 0.7 }}>↳</span>
              <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}>
                {cleanQuestTitle(parentQuest.title)}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Main row: checkbox + title + buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: isDaily ? 90 : 100 }}>
        <input
          type="checkbox"
          className="rune-check"
          checked={complete}
          onChange={() => toggleRoutine(routine.id)}
          style={{ flexShrink: 0 }}
        />
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
            style={{
              flex: 1, fontSize: 14, fontWeight: 500,
              background: 'var(--input-bg)', border: '1px solid var(--accent-border)',
              borderRadius: 6, color: 'var(--text-parchment)', padding: '2px 6px', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <span
            onClick={editMode ? startEdit : undefined}
            style={{
              flex: 1, fontSize: 14,
              color: complete ? 'var(--text-dim)' : 'var(--page-text)',
              textDecoration: complete ? 'line-through' : 'none',
              fontWeight: 500, lineHeight: 1.4,
              cursor: editMode ? 'text' : 'default',
            }}
          >
            {routine.title}
          </span>
        )}

        {/* Pin button — weekly routines only (daily are auto-shown on Today) */}
        {!isDaily && !editMode && (
          <button
            onClick={() => toggleRoutineTracked(routine.id)}
            style={{
              background: 'none',
              border: routine.trackedToday ? '1px solid var(--accent-border)' : '1px solid transparent',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 7px',
              fontFamily: 'inherit',
              color: routine.trackedToday ? 'var(--accent)' : 'var(--text-dim)',
              opacity: routine.trackedToday ? 1 : hovered ? 0.7 : 0,
              transition: 'opacity 0.2s, color 0.2s',
              flexShrink: 0,
            }}
          >
            {routine.trackedToday ? 'Pinned' : 'Pin'}
          </button>
        )}

        {/* Edit mode controls */}
        {editMode && hovered && (
          <>
            <button
              onClick={() => toggleRoutineHidden(routine.id)}
              title="Hide task"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.5 }}
            >
              👁
            </button>
            <button
              onClick={() => deleteRoutine(routine.id)}
              title="Delete task"
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '0 2px', opacity: 0.7 }}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Connect to a specific quest (edit mode) */}
      {editMode && parentQuestline && parentQuestline.quests.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', flexShrink: 0 }}>
            Connect to quest:
          </span>
          <select
            value={routine.questId ?? ''}
            onChange={e => setRoutineQuest(routine.id, e.target.value || null)}
            style={{
              flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 12,
              background: 'var(--input-bg)', border: '1px solid var(--card-border)',
              borderRadius: 6, color: 'var(--page-text)', padding: '4px 6px', cursor: 'pointer',
            }}
          >
            <option value="">No quest</option>
            {parentQuestline.quests.map(q => (
              <option key={q.id} value={q.id}>{cleanQuest(q.title)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Description */}
      {routine.description && (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {routine.description}
        </p>
      )}

      {/* Reset timer when complete (recurring tasks only) */}
      {complete && routine.recurring && (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '10px 0 0' }}>
          {getResetDisplay(routine)}
        </p>
      )}
    </div>
  );
}
