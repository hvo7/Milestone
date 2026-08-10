/**
 * What a brand-new install sees instead of three fabricated questlines.
 *
 * The demo data is genuinely useful for getting a feel for the app — but only if
 * you asked for it. Seeding it silently meant every first launch (and every
 * visitor to the public web build) opened onto someone else's goals, with no
 * indication they were fake or how to get rid of them.
 *
 * Shows only when there is nothing at all, so it disappears the moment the app
 * is actually in use and never reappears.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuestStore } from '../store';

export default function FirstRunCard({ onCreate }: { onCreate?: () => void }) {
  const questlines = useQuestStore(s => s.questlines);
  const routines = useQuestStore(s => s.routines);
  const loadSampleData = useQuestStore(s => s.loadSampleData);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  if (dismissed || questlines.length > 0 || routines.length > 0) return null;

  /** The examples are questlines, and none of their tasks are due today — so
   *  loading them and staying on Today looks exactly like nothing happened.
   *  Go to where the thing you just loaded actually is. */
  function handleLoadSample() {
    loadSampleData();
    navigate('/quests');
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="parchment glass-card"
      style={{ borderRadius: 16, padding: '22px 24px', marginBottom: 24 }}
    >
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--page-text)' }}>
        Welcome to Milestone
      </h2>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Long-term goals live in <strong style={{ color: 'var(--page-text-dim)' }}>questlines</strong>, broken
        into quests and tasks. Anything due surfaces here on <strong style={{ color: 'var(--page-text-dim)' }}>Today</strong>,
        whichever questline it came from — so the big goals actually move.
      </p>
      <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Everything stays on this device. Nothing is uploaded anywhere.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn-gold" style={{ flex: '1 1 160px' }} onClick={() => { setDismissed(true); onCreate?.(); }}>
          Start with my own goal
        </button>
        <button className="btn-ghost" style={{ flex: '1 1 160px' }} onClick={handleLoadSample}>
          Load example questlines
        </button>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-dim)' }}>
        The examples open in <strong style={{ color: 'var(--page-text-dim)' }}>Quests</strong> and are ordinary
        questlines — edit or delete them freely.
      </p>
    </motion.div>
  );
}
