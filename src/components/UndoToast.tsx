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

export default function UndoToast() {
  const entry = useUndoStore(s => s.entry);
  const run = useUndoStore(s => s.run);
  const dismiss = useUndoStore(s => s.dismiss);

  // Ctrl/⌘-Z, because that is the first thing anyone tries. Captured on window so
  // it works wherever focus is — except inside a field, where it has to keep
  // meaning "undo my typing".
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      // `instanceof Element`, not a cast: a key event can be dispatched at
      // `window` or `document`, neither of which has `closest`, and reaching for
      // it there throws and kills the handler outright.
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry, run]);

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
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          // The entrance springs; the exit is a short tween. A spring settling
          // toward zero opacity crosses its "done" threshold slowly, which left a
          // half-faded toast sitting on screen for over a second after it had
          // already been acted on — it should be gone the moment it's answered.
          exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          role="status"
          style={{
            position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)',
            zIndex: 200, maxWidth: 'min(560px, calc(100vw - 32px))',
            display: 'flex', flexDirection: 'column',
            borderRadius: 12, overflow: 'hidden',
            background: 'var(--page-surface)', border: '1px solid var(--page-border)',
            boxShadow: '0 14px 40px rgba(0,0,0,0.34)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px 12px 16px' }}>
            <span style={{ fontSize: 13, color: 'var(--page-text)', lineHeight: 1.4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.label}
            </span>
            <button
              className="btn-gold"
              onClick={onRun}
              style={{ marginLeft: 'auto', flexShrink: 0, padding: '5px 14px', fontSize: 12.5 }}
            >
              Undo
            </button>
            <button
              onClick={onDismiss}
              title="Dismiss"
              aria-label="Dismiss"
              style={{
                flexShrink: 0, background: 'none', border: 'none', padding: '0 2px',
                color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13, lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          {/* Drains rather than counting down in words: how long is left is worth
              showing, and reading "8… 7… 6…" is not. */}
          <div style={{ height: 2, background: 'var(--track-bg)' }}>
            <div style={{ width: `${Math.max(0, remaining) * 100}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
        </motion.div>
  );
}
