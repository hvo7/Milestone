import { useState, useEffect } from 'react';
import type { GuildColor, Questline, RecurringType } from '../types';
import { useQuestStore } from '../store';
import IconPicker from './IconPicker';
import ColorPicker from './ColorPicker';
import ModalShell from './ModalShell';

interface Props { questline: Questline; onClose: () => void; }

const RECUR_OPTS: { value: RecurringType | null; label: string }[] = [
  { value: null,      label: 'Never'   },
  { value: 'daily',   label: 'Daily'   },
  { value: 'weekly',  label: 'Weekly'  },
  { value: 'monthly', label: 'Monthly' },
];

function Label({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', display: 'block', marginBottom: 7 }}>{children}</label>;
}

export default function EditQuestlineModal({ questline, onClose }: Props) {
  const updateQuestline = useQuestStore(s => s.updateQuestline);
  const [title, setTitle]             = useState(questline.title);
  const [description, setDescription] = useState(questline.description);
  const [icon, setIcon]               = useState(questline.icon);
  const [color, setColor]             = useState<GuildColor>(questline.color);
  const [sequential, setSequential]   = useState(questline.sequential ?? false);
  const [recurring, setRecurring]     = useState<RecurringType | null>(questline.recurring ?? null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSave = () => {
    if (!title.trim()) return;
    updateQuestline(questline.id, { title: title.trim(), description: description.trim(), icon, color, sequential, recurring });
    onClose();
  };

  return (
    <ModalShell onClose={onClose} maxWidth={480} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
          <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: 'var(--page-text)' }}>Edit Questline</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Title */}
            <div>
              <Label>Title</Label>
              <input className="rune-input" autoFocus value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSave(); }} />
            </div>

            {/* Description */}
            <div>
              <Label>Description</Label>
              <textarea className="rune-input" rows={2} value={description} onChange={e => setDescription(e.target.value)} style={{ resize: 'vertical', minHeight: 56 }} />
            </div>

            {/* Icon */}
            <div>
              <Label>Icon</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>

            {/* Color */}
            <div>
              <Label>Color</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>

            {/* Quest order */}
            <div>
              <Label>Quest order</Label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ value: false, label: 'Flexible', desc: 'All quests available at once' }, { value: true, label: 'Sequential', desc: 'Complete quests in order' }].map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => setSequential(opt.value)}
                    title={opt.desc}
                    style={{
                      flex: 1, fontSize: 13, fontWeight: 500, padding: '8px 6px', borderRadius: 8, cursor: 'pointer',
                      border: sequential === opt.value ? '1px solid var(--accent)' : '1px solid var(--card-border)',
                      background: sequential === opt.value ? 'var(--accent-soft)' : 'var(--input-bg)',
                      color: sequential === opt.value ? 'var(--accent)' : 'var(--text-dim)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
                {sequential ? 'Each quest unlocks the next.' : 'Work on any quest at any time.'}
              </p>
            </div>

            {/* Recurrence */}
            <div>
              <Label>Repeats</Label>
              <div style={{ display: 'flex', gap: 6 }}>
                {RECUR_OPTS.map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => setRecurring(opt.value)}
                    style={{
                      flex: 1, fontSize: 13, fontWeight: 500, padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
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
              {recurring && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
                  All tasks in this questline reset {recurring === 'daily' ? 'every day' : recurring === 'weekly' ? 'every week' : 'every month'}.
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
              <button className="btn-gold" style={{ flex: 2, opacity: title.trim() ? 1 : 0.5 }} onClick={handleSave} disabled={!title.trim()}>Save</button>
            </div>
          </div>
    </ModalShell>
  );
}
