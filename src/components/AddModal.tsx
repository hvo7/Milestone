import { useState, useEffect } from 'react';
import type { GuildColor, RecurringType } from '../types';
import { useQuestStore } from '../store';
import IconPicker from './IconPicker';
import ColorPicker from './ColorPicker';
import ModalShell from './ModalShell';

type Mode =
  | { type: 'questline' }
  | { type: 'quest'; questlineId: string }
  | { type: 'action'; questlineId: string; questId: string }
  | { type: 'routine'; recurring: 'daily' | 'weekly'; questlineId?: string };

interface Props { mode: Mode; onClose: () => void; }

const QUEST_RECUR: { value: RecurringType | null; label: string }[] = [
  { value: null,      label: 'Once'    },
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
];

export default function AddModal({ mode, onClose }: Props) {
  const { addQuestline, addQuest, addAction, addRoutine } = useQuestStore();
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon]               = useState('');
  const [color, setColor]             = useState<GuildColor>('#a78bfa');
  const [recurring, setRecurring]     = useState<RecurringType | null>(null);
  const [dueDate, setDueDate]         = useState('');

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const headingMap: Record<string, string> = {
    questline: 'New Questline',
    quest:     'New Quest',
    action:    'New Task',
    routine:   mode.type === 'routine' ? `New ${mode.recurring === 'daily' ? 'Daily' : 'Weekly'} Task` : '',
  };

  const handleSubmit = () => {
    if (!title.trim()) return;
    if (mode.type === 'questline') {
      addQuestline(title.trim(), description.trim(), icon, color);
    } else if (mode.type === 'quest') {
      addQuest(mode.questlineId, title.trim(), description.trim(), recurring, dueDate || null);
    } else if (mode.type === 'action') {
      addAction(mode.questlineId, mode.questId, title.trim());
    } else {
      addRoutine(title.trim(), description.trim(), mode.recurring, mode.questlineId);
    }
    onClose();
  };

  return (
    <ModalShell onClose={onClose}>
          <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: 'var(--page-text)' }}>
            {headingMap[mode.type]}
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Title */}
            <div>
              <Label>{mode.type === 'action' ? 'Task' : 'Title'}</Label>
              <input
                className="rune-input"
                autoFocus
                placeholder={
                  mode.type === 'questline' ? 'e.g. Career Development' :
                  mode.type === 'quest'     ? 'e.g. Learn TypeScript' :
                  mode.type === 'routine'   ? 'e.g. Morning workout' :
                  'e.g. Read documentation'
                }
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              />
            </div>

            {/* Description — not for tasks */}
            {mode.type !== 'action' && (
              <div>
                <Label>Description <Optional /></Label>
                <textarea
                  className="rune-input"
                  placeholder="What is this about?"
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 56 }}
                />
              </div>
            )}

            {/* Icon + color — questlines only */}
            {mode.type === 'questline' && (
              <>
                <div>
                  <Label>Icon <Optional /></Label>
                  <IconPicker value={icon} onChange={setIcon} />
                </div>
                <div>
                  <Label>Color</Label>
                  <ColorPicker value={color} onChange={setColor} />
                </div>
              </>
            )}

            {/* Recurrence + due date — quests */}
            {mode.type === 'quest' && (
              <>
                <div>
                  <Label>Repeats</Label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {QUEST_RECUR.map(opt => (
                      <button
                        key={String(opt.value)}
                        onClick={() => setRecurring(opt.value)}
                        style={{
                          flex: 1, fontSize: 13, fontWeight: 500,
                          padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
                          border: recurring === opt.value ? '1px solid var(--accent)' : '1px solid var(--card-border)',
                          background: recurring === opt.value ? 'var(--accent-soft)' : 'var(--input-bg)',
                          color: recurring === opt.value ? 'var(--accent)' : 'var(--text-dim)',
                          transition: 'all 0.15s',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label>Due date <Optional /></Label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="rune-input"
                    style={{ cursor: 'pointer' }}
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
              <button
                className="btn-gold"
                style={{ flex: 2, opacity: title.trim() ? 1 : 0.45 }}
                onClick={handleSubmit}
                disabled={!title.trim()}
              >
                Create
              </button>
            </div>
          </div>
    </ModalShell>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      fontSize: 12, fontWeight: 600,
      color: 'var(--text-dim)',
      display: 'block', marginBottom: 7,
    }}>
      {children}
    </label>
  );
}

function Optional() {
  return <span style={{ fontWeight: 400, opacity: 0.7 }}>· optional</span>;
}
