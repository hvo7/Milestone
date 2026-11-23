/** How much of a thing is pinned to Today: nothing, part of it, or all of it.
 *  A single task is only ever 'none' or 'all'; 'some' is for a quest whose
 *  tasks are partly pinned. */
import Icon from './Icon';

export type PinState = 'none' | 'some' | 'all';

/**
 * 📌 toggle that puts a task — or every task in a quest — on the Today list.
 *
 * Lit while pinned; subdued but visible otherwise, including on touch screens.
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
      type="button"
      aria-label={title}
      aria-pressed={on}
      onClick={e => { e.stopPropagation(); if (!disabled) onClick(e); }}
      title={title}
      disabled={disabled}
      className="pin-button"
      style={{ fontSize: size, opacity: disabled ? 0.25 : on ? 1 : hovered ? 0.9 : 0.6 }}
    >
      {on ? <span>{state === 'some' ? 'Some on Today' : 'On Today'}</span> : <><Icon name="pin" size={15} />{label && <span>{label}</span>}</>}
    </button>
  );
}
