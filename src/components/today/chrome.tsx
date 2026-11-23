import { useEffect, useRef } from 'react';
import ProgressRing from '../ProgressRing';
import { claimDayClosed, isDayClosed } from '../../lib/dayClosed';

export function DaySwitcher({ preview, onChange }: {
  preview: boolean;
  onChange: (preview: boolean) => void;
}) {
  return (
    <div className="agenda-switch" role="group" aria-label="Planning day">
      <button type="button" aria-pressed={!preview} onClick={() => onChange(false)}>Today</button>
      <button type="button" aria-pressed={preview} onClick={() => onChange(true)}>Tomorrow</button>
    </div>
  );
}

export function DayProgress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round(100 * done / total) : 0;
  return (
    <section className="agenda-progress" aria-labelledby="agenda-progress-label">
      <div className="agenda-progress-line">
        <h2 id="agenda-progress-label">Day progress</h2>
        <span>{percent}%</span>
      </div>
      <progress aria-labelledby="agenda-progress-label" value={done} max={total || 1} />
      <p>{total ? `${done} of ${total} complete` : 'Nothing scheduled'}</p>
    </section>
  );
}

/**
 * The Pondside header's progress: a water bar and "2 of 7". At 100% the bar gives
 * way to a closed ring with a check and "Today's list is clear". The ring's
 * closing plays once per logical day (see lib/dayClosed.ts); after that, and
 * under reduced motion, it is simply shown closed.
 */
export function PondProgress({ done, total, dayKey, preview = false }: { done: number; total: number; dayKey: string; preview?: boolean }) {
  const closed = isDayClosed(done, total, preview);
  const node = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!closed) { node.current?.removeAttribute('data-play'); return; }
    if (claimDayClosed(dayKey)) node.current?.setAttribute('data-play', 'true');
  }, [closed, dayKey]);
  return (
    <section ref={node} className="pond-progress" data-closed={closed || undefined}>
      {closed && <ProgressRing value={1} done size={40} />}
      {/* Always present for assistive tech; visually replaced by the ring when closed. */}
      <progress className={closed ? 'visually-hidden' : undefined} aria-label="Day progress" value={done} max={total || 1} />
      <span className="pond-progress-count">
        {closed ? 'Today’s list is clear' : total ? `${done} of ${total}` : 'Nothing scheduled'}
      </span>
    </section>
  );
}
