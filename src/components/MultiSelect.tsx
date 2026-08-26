/**
 * A dropdown that takes several answers.
 *
 * The relationships in this app are all many-to-many — a habit belongs to any
 * number of systems, a system serves any number of goals — but rendering that as
 * a column of toggle buttons put the whole list on screen at all times, so a
 * drawer with seven questlines was mostly questlines you weren't picking. This
 * collapses to one line and opens only when asked, like every other picker.
 */
import { useEffect, useRef, useState } from 'react';

/** Tallest the open list gets before it scrolls itself. */
const MENU_MAX = 260;

export interface MultiOption {
  id: string;
  label: string;
}

export default function MultiSelect({ options, values, onToggle, placeholder = 'None', noun }: {
  options: MultiOption[];
  values: string[];
  onToggle: (id: string) => void;
  /** Shown when nothing is picked. */
  placeholder?: string;
  /** What several of them are called, for the summary line: "3 goals". */
  noun?: string;
}) {
  const [open, setOpen] = useState(false);
  // Decided at open time from where the control actually sits: a field near the
  // bottom of a drawer has nothing below it to open into.
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open) {
      const r = box.current?.getBoundingClientRect();
      const height = Math.min(MENU_MAX, options.length * 31 + 10);
      setUp(!!r && r.bottom + height > window.innerHeight && r.top > height);
    }
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const chosen = options.filter(o => values.includes(o.id));
  // One is worth naming; several would wrap, so they're counted instead.
  const summary = chosen.length === 0
    ? placeholder
    : chosen.length === 1
      ? chosen[0].label
      : `${chosen.length}${noun ? ` ${noun}` : ''}`;

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="rune-input"
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          fontFamily: 'inherit', fontSize: 14, padding: '9px 12px', cursor: 'pointer',
          color: chosen.length ? 'var(--page-text)' : 'var(--text-dim)',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-dim)' }}>▾</span>
      </button>

      {open && (
        <>
          {/* Catches the next click anywhere so it closes like a menu. */}
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div
            role="listbox"
            aria-multiselectable="true"
            style={{
              position: 'absolute', left: 0, right: 0, zIndex: 61,
              ...(up ? { bottom: '100%', marginBottom: 5 } : { top: '100%', marginTop: 5 }),
              maxHeight: MENU_MAX, overflowY: 'auto', padding: 5, borderRadius: 10,
              background: 'var(--card-bg-raised)', border: '1px solid var(--card-border)',
              boxShadow: '0 12px 34px rgba(0,0,0,0.36)',
            }}
          >
            {options.map(o => {
              const on = values.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  // Stays open on a pick: choosing one is rarely the end of it.
                  onClick={() => onToggle(o.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer',
                    padding: '7px 9px', borderRadius: 7, border: 'none',
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    color: on ? 'var(--accent)' : 'var(--page-text)',
                  }}
                >
                  <span aria-hidden="true" style={{ width: 11, flexShrink: 0, fontSize: 11 }}>{on ? '✓' : ''}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.label}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
