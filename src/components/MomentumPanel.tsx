/**
 * Momentum — the goal-level twin of the Systems tab's consistency list.
 *
 * That list names the habit you quietly stopped doing. This names the *goal* you
 * quietly stopped doing, which until now nothing in the app could see: a perfect
 * heatmap and a dead questline looked exactly the same, because a questline's
 * only reading was `done / total` and that number never moves on its own.
 *
 * Coldest first, deliberately. A panel sorted by progress would put the goals
 * doing well at the top, which is pleasant and useless — the whole reason to look
 * is the one you've forgotten about. Finished and brand-new questlines are folded
 * away under "the rest" for the same reason: neither is something to act on.
 *
 * The copy is chosen to make picking a goal back up feel ordinary. "cold" is a
 * temperature, not a grade, and the row's one action is a link straight into the
 * questline — the panel's job ends at telling you where to go.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuestStore } from '../store';
import {
  questlineMomentum, rankByNeglect, needsAttention, movedLabel, etaLabel,
  momentumHex, spanLabel, STATE_LABEL, type QuestlineMomentum,
} from '../lib/momentum';
import { categoryColor } from '../lib/ui';
import QuestIcon from './QuestIcon';

/** The state as a coloured dot plus its word. Small enough to sit in a row, and
 *  never red — see `momentumHex`. */
function StateChip({ m }: { m: QuestlineMomentum }) {
  const hex = momentumHex(m.state);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: hex, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: hex, letterSpacing: '0.01em' }}>
        {STATE_LABEL[m.state]}
      </span>
    </span>
  );
}

/**
 * The target date, once one is set: how long is left, and whether the rate you
 * are actually running is enough to get there.
 *
 * Silent when `onTrack` is null. There isn't always enough history to compare,
 * and a badge that guessed would be worse than no badge — this is the number
 * someone would plan around.
 */
function TargetChip({ m }: { m: QuestlineMomentum }) {
  const d = m.deadline;
  if (!d || m.state === 'done') return null;

  const overdue = d.daysLeft < 0;
  const color = overdue || d.onTrack === false ? '#fb923c' : d.onTrack ? '#34d399' : 'var(--page-text-dim)';
  const text = overdue
    ? `${spanLabel(-d.daysLeft)} past target`
    : `${spanLabel(d.daysLeft)} to target`;

  return (
    <span
      title={
        d.onTrack === null
          ? 'Not enough recent history to say whether this rate gets there.'
          : d.onTrack
            ? 'At the rate of the last 30 days, this lands before the target.'
            : 'At the rate of the last 30 days, this does not land before the target.'
      }
      style={{
        fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}55`,
        borderRadius: 999, padding: '1px 8px', flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

function MomentumRow({ m }: { m: QuestlineMomentum }) {
  const { questline: ql, progress } = m;
  const eta = etaLabel(m.pace);

  return (
    <Link
      to={`/questline/${ql.id}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div
        className="momentum-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 6px', borderBottom: '1px solid var(--card-border)',
          borderLeft: `2px solid ${categoryColor(ql.color)}`,
          paddingLeft: 10, borderRadius: 2,
        }}
      >
        <QuestIcon icon={ql.icon} size={17} style={{ flexShrink: 0 }} />

        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: 'var(--page-text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {ql.title}
          </span>
          {/* The sentence the app could never say before. */}
          <span style={{ fontSize: 11, color: 'var(--page-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {movedLabel(m.movement)}
            {eta && <> · {eta}</>}
          </span>
        </span>

        <TargetChip m={m} />
        <StateChip m={m} />

        <span
          title={`${progress.done} of ${progress.total} quests done`}
          style={{
            fontSize: 11, fontWeight: 600, color: 'var(--page-text-dim)',
            width: 40, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
          }}
        >
          {progress.done}/{progress.total}
        </span>
      </div>
    </Link>
  );
}

export default function MomentumPanel() {
  const questlines = useQuestStore(s => s.questlines);
  const routines = useQuestStore(s => s.routines);
  const taskHistory = useQuestStore(s => s.taskHistory);
  const [showRest, setShowRest] = useState(false);

  const visible = questlines.filter(ql => !ql.hidden);
  // Nothing to say about an empty install — the Quests page already tells you to
  // make your first questline, and a second empty panel above it would be noise.
  if (visible.length === 0) return null;

  const all = rankByNeglect(visible.map(ql => questlineMomentum(ql, routines, taskHistory)));
  const attention = all.filter(needsAttention);
  const rest = all.filter(m => !needsAttention(m));

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="parchment"
      style={{ borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--page-text)' }}>Momentum</h2>
        <span style={{ fontSize: 12, color: 'var(--page-text-dim)' }}>
          which goals are actually moving
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 12, fontWeight: 600,
          color: attention.length ? momentumHex(attention[0].state) : 'var(--success)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {attention.length ? `${attention.length} quiet` : 'all moving'}
        </span>
      </div>

      {attention.length > 0 ? (
        attention.map(m => <MomentumRow key={m.questline.id} m={m} />)
      ) : (
        <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--page-text-dim)', lineHeight: 1.6 }}>
          Everything you're aiming at has moved in the last week.
        </p>
      )}

      {rest.length > 0 && (
        <>
          <button
            onClick={() => setShowRest(v => !v)}
            className="btn-ghost"
            style={{ marginTop: 10, fontSize: 11.5, padding: '4px 10px', border: 'none' }}
          >
            {showRest ? '▾' : '▸'} {attention.length ? 'The rest' : 'All goals'} · {rest.length}
          </button>
          <AnimatePresence initial={false}>
            {showRest && (
              <motion.div
                key="rest"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                {rest.map(m => <MomentumRow key={m.questline.id} m={m} />)}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.section>
  );
}
