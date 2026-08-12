/**
 * Per-habit consistency — the view the heatmap can't give you.
 *
 * The heatmap answers "was I busy on the 14th". The question that actually
 * changes behaviour is the other one: *which* habit have I been quietly failing?
 * A thin week looks identical whether you missed one thing seven times or seven
 * things once each, and a current streak only tells you about the run you're in
 * — not the one you broke a fortnight ago and never restarted.
 *
 * So: one row per repeating task, worst first, with the last 30 days beside it.
 * Sorting by "longest since you last did it" puts the thing you've stopped doing
 * at the top, which is the whole point — it's the one you'd never think to look
 * for.
 *
 * Reads store.taskHistory, which only starts filling from the release that added
 * it. The empty state says so rather than implying you've done nothing.
 */
import { useState } from 'react';
import { useQuestStore, dateKey, logicalDayStart, repeats, historyOf } from '../store';
import type { Routine } from '../types';

/** Days of history shown per row. A month is long enough for a lapse to be
 *  obvious and short enough to fit on one line at a readable dot size. */
const WINDOW_DAYS = 30;

/** Rows shown before "Show all" — enough to see the problem, not so many that the
 *  panel becomes the page. */
const COLLAPSED_ROWS = 6;

const DOT = 7;
const DOT_GAP = 2;

interface Row {
  id: string;
  title: string;
  streak: number;
  /** One flag per day in the window, oldest first. */
  days: boolean[];
  hits: number;
  /** Days since the task was last completed; null when it never has been. */
  sinceLast: number | null;
}

/** "3d ago" / "today" / "never" — how long the row has been cold. */
function lastLabel(sinceLast: number | null): { text: string; cold: boolean } {
  if (sinceLast === null) return { text: 'not yet', cold: true };
  if (sinceLast === 0) return { text: 'today', cold: false };
  if (sinceLast === 1) return { text: 'yesterday', cold: false };
  return { text: `${sinceLast}d ago`, cold: sinceLast >= 7 };
}

export default function Consistency() {
  const routines = useQuestStore(s => s.routines);
  const taskHistory = useQuestStore(s => s.taskHistory);
  const [expanded, setExpanded] = useState(false);

  // Only repeating tasks. A one-off has no consistency to measure — it happened
  // once or it didn't, and its row would just be 29 empty dots.
  const habits = routines.filter((r): r is Routine => repeats(r) && !r.hidden);

  const today = logicalDayStart();
  const windowKeys: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    windowKeys.push(dateKey(new Date(today.getTime() - i * 86_400_000)));
  }
  const todayKey = windowKeys[windowKeys.length - 1];

  const rows: Row[] = habits.map(r => {
    const all = historyOf(taskHistory, r.id);
    const done = new Set(all);
    const newest = all[all.length - 1];
    return {
      id: r.id,
      title: r.title,
      streak: r.streak ?? 0,
      days: windowKeys.map(k => done.has(k)),
      hits: windowKeys.filter(k => done.has(k)).length,
      sinceLast: newest
        ? Math.round((Date.parse(`${todayKey}T00:00:00`) - Date.parse(`${newest}T00:00:00`)) / 86_400_000)
        : null,
    };
  });

  // Nothing recorded at all: either a fresh install or the first run after the
  // upgrade that started recording. Saying so beats an empty panel that reads as
  // "you have done nothing", which for an existing user would be a lie.
  const anyHistory = rows.some(r => r.hits > 0 || r.sinceLast !== null);
  if (!habits.length) return null;

  // Coldest first — a task never done sorts above one done a month ago, which
  // sorts above one done yesterday. Ties break on the emptier window.
  const sorted = [...rows].sort((a, b) =>
    (b.sinceLast ?? Number.MAX_SAFE_INTEGER) - (a.sinceLast ?? Number.MAX_SAFE_INTEGER)
    || a.hits - b.hits
    || a.title.localeCompare(b.title));

  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  return (
    <div className="parchment" style={{ borderRadius: 12, padding: '18px 22px', marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>Consistency</span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>last {WINDOW_DAYS} days</span>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {anyHistory
          ? 'Longest-neglected first — the habit you’ve stopped doing is the one you’d never think to check.'
          : 'Per-habit history starts from now. Check something off and it will show up here from tomorrow.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map(row => {
          const last = lastLabel(row.sinceLast);
          return (
            <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                title={row.title}
                style={{
                  flex: '1 1 0', minWidth: 0, fontSize: 12.5, color: 'var(--page-text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {row.title}
              </span>

              {row.streak > 1 && (
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#f97316' }}>🔥{row.streak}</span>
              )}

              <span
                style={{
                  flexShrink: 0, width: 62, textAlign: 'right',
                  fontSize: 11, fontWeight: 600,
                  color: last.cold ? 'var(--danger)' : 'var(--text-dim)',
                }}
              >
                {last.text}
              </span>

              {/* Oldest on the left, today on the right — the same direction the
                  heatmap reads, so the two don't disagree at a glance. */}
              <span
                aria-label={`${row.hits} of the last ${WINDOW_DAYS} days`}
                style={{ flexShrink: 0, display: 'flex', gap: DOT_GAP }}
              >
                {row.days.map((hit, i) => (
                  <span
                    key={i}
                    title={`${windowKeys[i]}${hit ? ' · done' : ''}`}
                    style={{
                      width: DOT, height: DOT, borderRadius: 2,
                      background: hit ? 'var(--heat-3)' : 'var(--heat-0)',
                      outline: windowKeys[i] === todayKey ? '1px solid var(--accent)' : 'none',
                      outlineOffset: 1,
                    }}
                  />
                ))}
              </span>

              <span style={{ flexShrink: 0, width: 34, textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                {row.hits}/{WINDOW_DAYS}
              </span>
            </div>
          );
        })}
      </div>

      {sorted.length > COLLAPSED_ROWS && (
        <button
          className="btn-ghost"
          onClick={() => setExpanded(v => !v)}
          style={{ marginTop: 12, width: '100%', padding: '6px 0', fontSize: 12 }}
        >
          {expanded ? 'Show fewer' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}
