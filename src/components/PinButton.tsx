/** How much of a thing is pinned to Today: nothing, part of it, or all of it.
 *  A single task is only ever 'none' or 'all'; 'some' is for a quest whose
 *  tasks are partly pinned. */
export type PinState = 'none' | 'some' | 'all';

/**
 * 📌 toggle that puts a task — or every task in a quest — on the Today list.
 *
 * Stays visible while pinned so it can always be undone, and fades in on hover
 * otherwise, so a quest full of unpinned tasks doesn't read as a wall of pins.
 */
export default function PinButton({
  state, onClick, title, disabled = false, hovered = false, size = 12, label,
}: {
  state: PinState;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  disabled?: boolean;
  /** Parent row hover — reveals the pin when nothing is pinned yet. */
  hovered?: boolean;
  size?: number;
  /** Optional text beside the glyph (used on wider quest rows). */
  label?: string;
}) {
  const on = state !== 'none';
  return (
    <button
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(e); }}
      title={title}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        background: on ? 'var(--accent-soft)' : 'none',
        border: `1px solid ${on ? 'var(--accent-border)' : 'transparent'}`,
        borderRadius: 6, padding: label ? '2px 7px' : '2px 4px',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', fontSize: size, fontWeight: 600, lineHeight: 1.5,
        color: on ? 'var(--accent)' : 'var(--text-dim)',
        // Pinned stays lit; unpinned only appears on hover, and a disabled pin
        // (a quest with no tasks yet) never advertises itself.
        opacity: disabled ? 0.25 : on ? 1 : hovered ? 0.75 : 0,
        transition: 'opacity 0.18s, color 0.18s, background 0.18s',
      }}
    >
      <span style={{ filter: on ? 'none' : 'grayscale(1)', fontSize: size }}>📌</span>
      {label && <span>{state === 'some' ? `${label} · some` : on ? 'Pinned' : label}</span>}
    </button>
  );
}
