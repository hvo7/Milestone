import { useQuestStore, dateKey, logicalDayStart } from '../store';

const DEFAULT_WEEKS = 26;     // ~6 months of history

// Baseline: 5 completed tasks = a fully green day.
// 0 → empty · 1 → faint · 2-3 → medium · 4-5 → strong · 6+ → brightest
function level(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3)  return 2;
  if (count <= 5)  return 3;
  return 4;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

export default function Heatmap({ weeks: WEEKS = DEFAULT_WEEKS, compact = false, closedToday = false }: {
  weeks?: number;
  /** The rail's version: cells only, sized to its panel. */
  compact?: boolean;
  /** The day's list is clear — today's cell shows full. */
  closedToday?: boolean;
} = {}) {
  const completionLog = useQuestStore(s => s.completionLog);
  const CELL = compact ? 13 : 12;
  const GAP = compact ? 5 : 3;

  // Grid starts on the Sunday WEEKS-1 weeks back, ends on the current logical
  // day (which rolls over at 5am, matching how completions are bucketed).
  const today = logicalDayStart();
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);

  // columns[w][d] — one Date per cell; null for days after today
  const columns: (Date | null)[][] = [];
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    const col: (Date | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      col.push(date > today ? null : date);
    }
    const firstOfCol = col.find(c => c !== null);
    if (firstOfCol && firstOfCol.getMonth() !== lastMonth) {
      // Label only when the month actually starts in this column (skip partial first column repeats)
      if (lastMonth !== -1 || firstOfCol.getDate() <= 7 || columns.length === 0) {
        monthLabels.push({ col: w, label: MONTHS[firstOfCol.getMonth()] });
      }
      lastMonth = firstOfCol.getMonth();
    }
    columns.push(col);
  }

  const todayKey = dateKey(today);
  const totalAllTime = Object.values(completionLog).reduce((a, b) => a + b, 0);
  const todayCount = completionLog[todayKey] ?? 0;

  const cell = (date: Date, d: number) => {
    const key = dateKey(date);
    const count = completionLog[key] ?? 0;
    const isToday = key === todayKey;
    return (
      <span
        key={d}
        className="heat-cell"
        data-today={isToday || undefined}
        data-closed={(isToday && closedToday) || undefined}
        title={`${count} task${count !== 1 ? 's' : ''} on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        style={{ width: CELL, height: CELL, background: `var(--heat-${isToday && closedToday ? 4 : level(count)})` }}
      />
    );
  };

  if (compact) {
    return (
      <div role="img" aria-label={`Completed tasks over the last ${WEEKS} weeks`} style={{ display: 'flex', gap: GAP, overflowX: 'auto', padding: 3 }}>
        {columns.map((col, w) => (
          <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
            {col.map((date, d) => date ? cell(date, d) : <span key={d} style={{ width: CELL, height: CELL }} />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="parchment" style={{ padding: '18px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--page-text)' }}>
          Activity
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {todayCount} today · {totalAllTime} total
        </span>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'inline-block' }}>
          {/* Month labels */}
          <div style={{ position: 'relative', height: 14, marginLeft: 30 }}>
            {monthLabels.map(({ col, label }, i) => (
              <span key={`${label}-${i}`} style={{
                position: 'absolute',
                left: col * (CELL + GAP),
                fontSize: 11,
                color: 'var(--text-dim)',
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: GAP }}>
            {/* Day labels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, width: 27, marginRight: GAP }}>
              {Array.from({ length: 7 }, (_, d) => (
                <span key={d} style={{ height: CELL, fontSize: 9, lineHeight: `${CELL}px`, color: 'var(--text-dim)' }}>
                  {DAY_LABELS[d] ?? ''}
                </span>
              ))}
            </div>

            {/* Cells */}
            {columns.map((col, w) => (
              <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {col.map((date, d) => date ? cell(date, d) : <span key={d} style={{ width: CELL, height: CELL }} />)}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 10 }}>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginRight: 2 }}>Less</span>
            {[0, 1, 2, 3, 4].map(l => (
              <span key={l} className="heat-cell" style={{ width: CELL, height: CELL, background: `var(--heat-${l})` }} />
            ))}
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 2 }}>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
