/**
 * The bare glyph buttons scattered across rows and headers — ✎ edit, ✕ delete,
 * ＋ add, ⏭ skip. Every page had rolled its own: the same inline style object
 * plus a pair of onMouseEnter/onMouseLeave handlers to swap the colour by hand.
 *
 * The colours live in `.icon-btn` in index.css (see there for the two custom
 * properties); this owns the cast that lets them be set from a style prop, and
 * the stopPropagation that row-level buttons need — a ✕ on a quest row must not
 * also trigger the row's own expand-on-click.
 */
import type { CSSProperties, ReactNode, MouseEvent } from 'react';

interface Props {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  title: string;
  children: ReactNode;
  /** Resting colour. Omit for the usual dimmed grey. */
  rest?: string;
  /** Hover colour. Omit for the app accent; pass `var(--danger)` to destroy. */
  hover?: string;
  size?: number;
  /** Resting opacity for buttons that sit half-lit until pointed at; they
   *  brighten to 1 on their own hover. */
  fade?: number;
  /** Reveal-on-hover buttons pass their *parent row's* hover state here — that
   *  can't be CSS :hover, since the trigger is the row rather than the button. */
  opacity?: number;
  /** Set on buttons inside a clickable row, so the click doesn't also hit the row. */
  stopPropagation?: boolean;
  style?: CSSProperties;
}

export default function IconButton({
  onClick, title, children, rest, hover, size = 13, fade, opacity, stopPropagation, style,
}: Props) {
  return (
    <button
      type="button"
      title={title}
      // The label is the only thing a screen reader has to go on: the content is
      // a bare glyph (✎, ✕, an SVG), and `title` alone is not reliably announced.
      aria-label={title}
      onClick={e => { if (stopPropagation) e.stopPropagation(); onClick(e); }}
      className="icon-btn"
      style={{
        '--icon-btn-rest': rest,
        '--icon-btn-hover': hover,
        '--icon-btn-fade': fade,
        fontSize: size,
        ...(opacity === undefined ? {} : { opacity }),
        ...style,
      } as CSSProperties}
    >
      {children}
    </button>
  );
}
