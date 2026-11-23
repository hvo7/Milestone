/**
 * The visible half of the undo in lib/undo.ts — a toast naming what just vanished
 * and offering it back.
 *
 * The label carries the cascade ("· 4 quests, 3 tasks") because that is the part
 * nothing else on screen says: a questline's ✕ looks like it removes one row, and
 * it doesn't. Seeing the real cost immediately after is what makes the offer
 * worth reading.
 *
 * Mounted once, above the routes, so a delete on any page can be taken back —
 * including one that navigated away from the thing it deleted.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useIsPresent } from 'framer-motion';
import { useUndoStore, UNDO_WINDOW_MS, type UndoEntry } from '../lib/undo';
import Icon from './Icon';

export default function UndoToast() {
  const entry = useUndoStore(s => s.entry);
  const run = useUndoStore(s => s.run);
  const dismiss = useUndoStore(s => s.dismiss);

  // Ctrl/⌘-Z is bound once, in lib/history.ts, and reaches this toast from there.
  // Handling it here as well meant two listeners answering one press.

  return (
    <AnimatePresence>
      {/* Keyed by entry id so a second delete remounts the toast: the countdown
          state below then starts fresh per entry, instead of needing an effect to
          reach back and reset it. */}
      {entry && <Toast key={entry.id} entry={entry} onRun={run} onDismiss={dismiss} />}
    </AnimatePresence>
  );
}

function Toast({ entry, onRun, onDismiss }: { entry: UndoEntry; onRun: () => void; onDismiss: () => void }) {
  const [remaining, setRemaining] = useState(1);
  // AnimatePresence keeps this mounted while it animates out, and the countdown
  // below would keep re-rendering it the whole way — which fights the exit
  // animation and leaves the toast half-faded on screen for seconds. Once it's
  // leaving, neither the bar nor the auto-dismiss has anything left to do.
  const present = useIsPresent();

  useEffect(() => {
    if (!present) return;
    const tick = setInterval(() => {
      const left = 1 - (Date.now() - entry.at) / UNDO_WINDOW_MS;
      if (left <= 0) { onDismiss(); return; }
      setRemaining(left);
    }, 100);
    return () => clearInterval(tick);
  }, [entry, onDismiss, present]);

  return (
        <motion.div
          className="toast"
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          // The entrance springs; the exit is a short tween. A spring settling
          // toward zero opacity crosses its "done" threshold slowly, which left a
          // half-faded toast sitting on screen for over a second after it had
          // already been acted on — it should be gone the moment it's answered.
          exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          role="status"
          data-toast-kind={entry.art ? 'quest-complete' : undefined}
          style={{
            bottom: 'var(--toast-bottom, 26px)', zIndex: 200,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 14px' }}>
            {/* A quest finishing gets its questline's art tile and what it unlocked. */}
            {entry.art && <img className="toast-art" src={entry.art} alt="" width={44} height={44} />}
            <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
              <span className="toast-label" style={{ fontSize: 13.5, fontWeight: entry.art ? 700 : 400, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.label}
              </span>
              {entry.detail && <span className="toast-detail" style={{ fontSize: 12.5, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.detail}
              </span>}
            </span>
            <button type="button" className="btn-gold" onClick={onRun} style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {entry.action ?? 'Undo'}
            </button>
            <button type="button" className="icon-btn-round" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
              <Icon name="close" size={16} />
            </button>
          </div>
          {/* Drains rather than counting down in words: how long is left is worth
              showing, and reading "8… 7… 6…" is not. */}
          <div style={{ height: 3, background: 'var(--raised)' }}>
            <div style={{ width: `${Math.max(0, remaining) * 100}%`, height: '100%', background: 'var(--water)' }} />
          </div>
        </motion.div>
  );
}
