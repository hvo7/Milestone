import type { GuildColor } from '../types';
import { categoryColor } from '../lib/ui';

interface Props {
  done: number;
  total: number;
  color: GuildColor;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export default function ProgressBar({ done, total, color, showLabel = true, size = 'md' }: Props) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div style={{ width: '100%' }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Progress
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--page-text)' }}>
            {done} / {total}
          </span>
        </div>
      )}
      <div className="hp-track" style={{ height: size === 'sm' ? 5 : 7 }}>
        <div
          className="hp-fill"
          style={{ width: `${pct}%`, background: categoryColor(color) }}
        />
      </div>
    </div>
  );
}
