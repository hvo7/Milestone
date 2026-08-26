/**
 * The centred modal shell — dimmed overlay, click-outside to close, and the card
 * that springs in on top of it. Four modals had copied the same twelve lines of
 * framer-motion setup; the entrance now lives here, so they can't drift apart.
 *
 * The panel stops click propagation itself: without it, every click *inside* a
 * modal would reach the overlay and close it.
 */
import { motion, AnimatePresence } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

interface Props {
  onClose: () => void;
  children: ReactNode;
  /** Panel width cap. The panel is fluid below it. */
  maxWidth?: number;
  /** Extra panel styling — padding, border radius, scroll behaviour. */
  style?: CSSProperties;
  /** Extra overlay styling. Rarely needed: the overlay already scrolls and
   *  top-aligns by itself once a panel outgrows the window (see index.css). */
  overlayStyle?: CSSProperties;
  /** Entrance spring. Defaults to the standard modal pop. */
  spring?: { stiffness: number; damping: number };
  /** How far the panel travels and how small it starts. */
  from?: { scale: number; y: number };
}

export default function ModalShell({
  onClose, children, maxWidth = 460, style, overlayStyle,
  spring = { stiffness: 380, damping: 32 },
  from = { scale: 0.96, y: 12 },
}: Props) {
  const hidden = { opacity: 0, ...from };
  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={overlayStyle}
      >
        <motion.div
          className="parchment"
          initial={hidden}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={hidden}
          transition={{ type: 'spring', ...spring }}
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', maxWidth, borderRadius: 14, padding: '24px', ...style }}
        >
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
