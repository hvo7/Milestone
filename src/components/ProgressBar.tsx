import type { GuildColor } from '../types';

interface Props {
  done: number;
  total: number;
  /** Kept for callers; progress is always drawn in the water colour. */
  color?: GuildColor;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export default function ProgressBar({ done, total, showLabel = true, size = 'md' }: Props) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div style={{ width: '100%' }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-dim)' }}>
            Progress
          </span>
          <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
            {done} / {total}
          </span>
        </div>
      )}
      <div className="hp-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
        style={{ height: size === 'sm' ? 6 : 8 }}>
        <div className="hp-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
