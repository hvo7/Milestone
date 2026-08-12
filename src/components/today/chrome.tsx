/** The furniture around the Today list: the progress bar, the category filter
 *  chips, and the button that flips to tomorrow's preview. */
import { motion } from 'framer-motion';

export function ProgressSummary({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = total > 0 && done === total;
  return (
    <div className="parchment glass-card" style={{ borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: allDone ? 'var(--success)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {done}/{total} {allDone ? '· all done ✦' : 'done'}
        </span>
      </div>
      <div style={{ height: 8, background: 'var(--track-bg)', borderRadius: 999, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className={allDone ? 'bar-fill bar-fill-done' : 'bar-fill'}
          style={{ height: '100%', borderRadius: 999 }}
        />
      </div>
      {total === 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
          Add tasks below to start tracking your day.
        </p>
      )}
    </div>
  );
}

/** One filter chip: category name, a colour dot, and how many are still open. */
export function Chip({ label, icon, color, open, total, active, onClick }: {
  label: string; icon?: string; color?: string;
  open: number; total: number; active: boolean; onClick: () => void;
}) {
  const cleared = total > 0 && open === 0;
  return (
    <button type="button" className="chip" data-active={active} onClick={onClick}>
      {icon
        ? <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
        : color && <span className="chip-dot" style={{ background: color }} />}
      <span>{label}</span>
      <span className="chip-count" style={cleared ? { color: 'var(--success)' } : undefined}>
        {cleared ? '✓' : open}
      </span>
    </button>
  );
}

/** The edge button that flips between today and the tomorrow preview. The two
 *  directions are the same button mirrored — side, arrow, nudge and label all
 *  follow from `forward`. */
export function DayFlipper({ forward, onClick }: { forward: boolean; onClick: () => void }) {
  const sign = forward ? 1 : -1;
  return (
    <motion.button
      onClick={onClick}
      title={forward ? 'Peek at tomorrow — dailies reset, plan the next day' : 'Back to today'}
      initial={{ opacity: 0, x: sign * 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: sign * 24 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      className="day-flipper"
      style={{ position: 'fixed', [forward ? 'right' : 'left']: 16, top: '38%', zIndex: 30 }}
    >
      <motion.span
        animate={{ x: [0, sign * 5, 0] }}
        transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
        style={{ display: 'block', fontSize: 20, lineHeight: 1 }}
      >
        {forward ? '→' : '←'}
      </motion.span>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em' }}>{forward ? 'TMRW' : 'TODAY'}</span>
    </motion.button>
  );
}
