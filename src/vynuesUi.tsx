import { useEffect, useRef, useState } from 'react';
import type { ProjectColor, TaskPriority, TaskRecurrence } from './vynuesStore';

/** Project accent colours — the app's fixed palette (see index.css --color-*). */
export const PROJECT_COLOR_VAR: Record<ProjectColor, string> = {
  crimson:  'var(--color-crimson)',
  sapphire: 'var(--color-sapphire)',
  emerald:  'var(--color-emerald)',
  amber:    'var(--color-amber)',
  violet:   'var(--color-violet)',
};

/** Priority labels, accent colours, and sort weights — shared across the Vynues UI. */
export const PRIORITY_META: Record<TaskPriority, { label: string; color: string; weight: number }> = {
  high:   { label: 'High',   color: 'var(--color-crimson)',  weight: 3 },
  medium: { label: 'Medium', color: 'var(--color-amber)',    weight: 2 },
  low:    { label: 'Low',    color: 'var(--color-sapphire)', weight: 1 },
};

/**
 * A segmented Low / Medium / High control. Replaces a native <select>, whose
 * dropdown popup is OS-rendered and unreadable against the dark theme.
 */
export function PrioritySegmented({ value, onChange }: { value: TaskPriority; onChange: (p: TaskPriority) => void }) {
  const opts: TaskPriority[] = ['low', 'medium', 'high'];
  return (
    <div style={{
      display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--input-border)', background: 'var(--input-bg)',
    }}>
      {opts.map((p, i) => {
        const active = value === p;
        const meta = PRIORITY_META[p];
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            title={`${meta.label} priority`}
            style={{
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              padding: '8px 13px', border: 'none', whiteSpace: 'nowrap',
              borderLeft: i > 0 ? '1px solid var(--input-border)' : 'none',
              background: active ? meta.color : 'transparent',
              color: active ? '#fff' : 'var(--text-dim)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** Short label for a recurrence value (badges, summaries). */
export const RECURRENCE_LABEL: Record<'daily' | 'weekly' | 'monthly', string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
};

/** A segmented Once / Daily / Weekly / Monthly control for task recurrence. */
export function RecurrenceSegmented({ value, onChange }: { value: TaskRecurrence; onChange: (r: TaskRecurrence) => void }) {
  const opts: { key: TaskRecurrence; label: string }[] = [
    { key: null,      label: 'Once' },
    { key: 'daily',   label: 'Daily' },
    { key: 'weekly',  label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
  ];
  return (
    <div style={{
      display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--input-border)', background: 'var(--input-bg)',
    }}>
      {opts.map((o, i) => {
        const active = value === o.key;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(o.key)}
            title={o.key ? `Repeats ${o.label.toLowerCase()}` : 'One-off task'}
            style={{
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              padding: '8px 12px', border: 'none', whiteSpace: 'nowrap',
              borderLeft: i > 0 ? '1px solid var(--input-border)' : 'none',
              background: active ? 'var(--accent-strong)' : 'transparent',
              color: active ? '#fff' : 'var(--text-dim)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A compact dropdown rendered with the app's tokens (the native <select> popup
 *  is OS-styled and unreadable in dark mode). Closes on outside-click / Escape. */
export function MenuSelect<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = options.find(o => o.key === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          padding: '5px 11px', borderRadius: 8, whiteSpace: 'nowrap',
          border: open ? '1px solid var(--accent-border)' : '1px solid var(--card-border)',
          background: open ? 'var(--accent-soft)' : 'transparent',
          color: 'var(--text-dim)', transition: 'all 0.15s',
        }}
      >
        <span style={{ opacity: 0.8 }}>{label}:</span>{' '}
        <span style={{ color: 'var(--page-text)', fontWeight: 600 }}>{current?.label}</span>
        <span style={{ marginLeft: 4, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
          minWidth: 168, padding: 4, display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
        }}>
          {options.map(o => (
            <button
              key={o.key}
              type="button"
              className={`v-menu-item${o.key === value ? ' active' : ''}`}
              onClick={() => { onChange(o.key); setOpen(false); }}
            >
              {o.label}{o.key === value ? '  ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Convert a stored dueDate (ISO, datetime-local, or date-only) to the
 *  `YYYY-MM-DDTHH:mm` form an <input type="datetime-local"> expects. */
export function toDateTimeLocalInput(value?: string | null): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;       // already correct
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00`;        // legacy date-only → noon
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
