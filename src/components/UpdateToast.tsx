/**
 * "A newer build is out there and you are not on it."
 *
 * Only ever seen on the web and phone copies, and only while the app is on
 * screen: an update that arrives while you are looking at something else is
 * taken silently the moment the app is backgrounded, so this toast is the
 * narrow case of a release landing under your thumb (see lib/appUpdate.ts).
 *
 * It offers rather than acts, because it is the one moment where reloading
 * could interrupt something — and it stays put until answered instead of timing
 * out like the undo toast, since the choice is still valid a minute later.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useAppUpdate, applyUpdate } from '../lib/appUpdate';
import { useUndoStore } from '../lib/undo';

export default function UpdateToast() {
  const ready = useAppUpdate(s => s.ready);
  const nextVersion = useAppUpdate(s => s.nextVersion);
  // The undo toast owns the bottom of the screen and is the more time-critical
  // of the two — twelve seconds versus "whenever you like" — so this one steps
  // up out of its way rather than covering it.
  const undoOpen = !!useUndoStore(s => s.entry);

  return (
    <AnimatePresence>
      {ready && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 460, damping: 34 }}
          role="status"
          className="toast"
          style={{
            bottom: undoOpen ? 'calc(var(--toast-bottom, 26px) + 78px)' : 'var(--toast-bottom, 26px)', zIndex: 190,
            flexDirection: 'row', alignItems: 'center', gap: 14,
            padding: '10px 10px 10px 16px',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--page-text)', lineHeight: 1.4 }}>
            {nextVersion ? `Milestone ${nextVersion} is ready.` : 'A new version is ready.'}
          </span>
          <button type="button" className="btn-gold" style={{ whiteSpace: 'nowrap' }} onClick={applyUpdate}>
            Reload
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
