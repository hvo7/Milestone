/**
 * The two strips that sit *under* a Today row, for the two kinds of goal a plain
 * counter can't express on its own.
 *
 *   SessionStrip   — "go to the gym 3 times a week". One pip per day of the
 *                    cycle; a day is done or it isn't, so three visits can't be
 *                    tapped into one afternoon.
 *   CheckpointPips — "drink 64 oz". One pip per step; tap the third of four to
 *                    jump straight to 48 instead of nudging ＋ three times.
 *
 * Under the row rather than in it, deliberately: the row's job is still "is this
 * done", and a strip wide enough to be tappable would crowd the title out. Both
 * appear only where they mean something — see `sessionMode` and the segment cap
 * below — so an ordinary checkbox task grows nothing at all.
 *
 * `compact` is the anchor rail's variant: the rail is a 300px column, so the pips
 * shrink and the caption goes away — the rail row prints the same numbers on its
 * own meta line, and printing them twice in 240px is what made it unreadable.
 */
import { dayInitial, logicalDateKey } from '../../store';

const PIP = 22;
const PIP_GAP = 4;

const pipBase: React.CSSProperties = {
  width: PIP, height: PIP, borderRadius: 6, padding: 0,
  border: '1px solid var(--page-border)',
  background: 'var(--page-surface)',
  color: 'var(--page-text-dim)',
  fontFamily: 'inherit', fontSize: 10, fontWeight: 700, lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s',
};

/** Shared framing so both strips indent and caption identically. */
function StripFrame({ indent, children, caption }: { indent: number; children: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, paddingLeft: indent, flexWrap: 'wrap' }}>
      <span style={{ display: 'flex', gap: PIP_GAP, flexWrap: 'wrap' }}>{children}</span>
      {caption && (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--page-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
          {caption}
        </span>
      )}
    </div>
  );
}

export interface SessionStripProps {
  /** Logical day keys of the current cycle, ascending. */
  days: string[];
  /** The days a session is logged on. */
  logged: string[];
  target: number;
  /** Left padding, so the strip lines up with the row's text rather than its grip. */
  indent: number;
  onToggle: (dayKey: string) => void;
  readOnly?: boolean;
  /** Rail variant: smaller pips, no caption. */
  compact?: boolean;
}

export function SessionStrip({ days, logged, target, indent, onToggle, readOnly, compact }: SessionStripProps) {
  const today = logicalDateKey();
  const done = logged.length;
  const size = compact ? 19 : PIP;

  return (
    <StripFrame
      indent={indent}
      caption={compact ? undefined : (
        <>
          {done}/{target} this cycle
          {done > target && <span style={{ color: 'var(--success)' }}> · {done - target} extra</span>}
        </>
      )}
    >
      {days.map(day => {
        const on = logged.includes(day);
        const isToday = day === today;
        // A day that hasn't happened isn't a session you can have had. Tapping a
        // past one is how you fix the Tuesday you forgot to log.
        const future = day > today;
        const disabled = readOnly || future;
        return (
          <button
            key={day}
            type="button"
            onClick={e => { e.stopPropagation(); if (!disabled) onToggle(day); }}
            disabled={disabled}
            title={
              future ? 'Hasn’t happened yet'
                : isToday ? (on ? 'Logged today — click to undo' : 'Log today’s session')
                : `${on ? 'Logged' : 'Not logged'} on ${day}${on ? ' — click to undo' : ' — click to backfill'}`
            }
            aria-pressed={on}
            aria-label={`${day}${isToday ? ' (today)' : ''}: ${on ? 'session logged' : 'no session'}`}
            style={{
              ...pipBase,
              width: size, height: size,
              background: on ? 'var(--success)' : 'var(--page-surface)',
              borderColor: on ? 'var(--success)' : isToday ? 'var(--accent)' : 'var(--page-border)',
              color: on ? '#0b1210' : isToday ? 'var(--accent)' : 'var(--page-text-dim)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: future ? 0.3 : 1,
            }}
          >
            {dayInitial(day)}
          </button>
        );
      })}
    </StripFrame>
  );
}

export interface CheckpointPipsProps {
  progress: number;
  target: number;
  step: number;
  unit?: string;
  indent: number;
  onSet: (value: number) => void;
  readOnly?: boolean;
  compact?: boolean;
}

export function CheckpointPips({ progress, target, step, unit, indent, onSet, readOnly, compact }: CheckpointPipsProps) {
  const segments = Math.ceil(target / Math.max(1, step));
  const filled = Math.floor(progress / Math.max(1, step));
  const withUnit = (v: number) => `${v}${unit ? ` ${unit}` : ''}`;

  // No caption: the counter beside (or above) the pips already prints the same
  // "12/64 oz", and the row only has room to say it once.
  return (
    <StripFrame indent={indent}>
      {Array.from({ length: segments }, (_, i) => {
        const level = Math.min(target, (i + 1) * step);
        const on = i < filled;
        // Tapping the pip you're already at means "undo back to here" — otherwise
        // the topmost filled pip would be the one thing you couldn't take back.
        const next = on && i === filled - 1 ? i * step : level;
        return (
          <button
            key={i}
            type="button"
            onClick={e => { e.stopPropagation(); if (!readOnly) onSet(next); }}
            disabled={readOnly}
            title={on && i === filled - 1 ? `Back to ${withUnit(i * step)}` : `Set to ${withUnit(level)}`}
            aria-pressed={on}
            aria-label={withUnit(level)}
            style={{
              ...pipBase,
              width: compact ? 26 : PIP + 8,
              height: compact ? 19 : PIP,
              fontSize: compact ? 9.5 : 10,
              background: on ? 'var(--accent)' : 'var(--page-surface)',
              borderColor: on ? 'var(--accent)' : 'var(--page-border)',
              color: on ? '#fff' : 'var(--page-text-dim)',
              cursor: readOnly ? 'default' : 'pointer',
            }}
          >
            {level}
          </button>
        );
      })}
    </StripFrame>
  );
}
