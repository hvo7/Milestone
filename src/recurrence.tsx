import { useState } from 'react';
import type { RecurringType, MonthlyRule, NthPosition, DayKind } from './types';
import { recurrenceLabel } from './store';
import {
  monthlyRuleLabel, currentMonthIndex, NTH_LABEL, KIND_LABEL,
} from './lib/monthlyRule';
import { MenuSelect } from './vynuesUi';

/** A recurrence choice as the stores model it: a base cadence bucket, an optional
 *  custom interval in days (weekly + 21 = "every 3 weeks"), or a calendar rule
 *  ("first Monday of the month") which takes precedence over both. */
export interface RepeatValue {
  recurring: RecurringType | null;
  intervalDays?: number;
  monthlyRule?: MonthlyRule | null;
}

type Unit = 'day' | 'week' | 'month';
const UNIT_DAYS: Record<Unit, number> = { day: 1, week: 7, month: 30 };
const UNIT_LABEL: Record<Unit, string> = { day: 'days', week: 'weeks', month: 'months' };

/** Turn a stored (recurring, intervalDays) into the picker's count + unit. */
function decode(recurring: RecurringType | null | undefined, intervalDays?: number): { repeat: boolean; count: number; unit: Unit } {
  if (intervalDays && intervalDays > 0) {
    if (intervalDays % 30 === 0) return { repeat: true, count: intervalDays / 30, unit: 'month' };
    if (intervalDays % 7 === 0)  return { repeat: true, count: intervalDays / 7,  unit: 'week' };
    return { repeat: true, count: intervalDays, unit: 'day' };
  }
  if (recurring === 'daily')   return { repeat: true, count: 1, unit: 'day' };
  if (recurring === 'weekly')  return { repeat: true, count: 1, unit: 'week' };
  if (recurring === 'monthly') return { repeat: true, count: 1, unit: 'month' };
  return { repeat: false, count: 1, unit: 'week' };
}

/** Build the stored value. A count of 1 maps to the plain cadence (no interval). */
function encode(count: number, unit: Unit): RepeatValue {
  const c = Math.max(1, Math.floor(count) || 1);
  const recurring: RecurringType = unit === 'day' ? 'daily' : unit === 'week' ? 'weekly' : 'monthly';
  return { recurring, intervalDays: c > 1 ? c * UNIT_DAYS[unit] : undefined };
}

function segBtn(active: boolean, onClick: () => void, label: string, key?: string) {
  return (
    <button
      key={key ?? label}
      type="button"
      onClick={onClick}
      style={{
        fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        padding: '5px 11px', border: 'none', whiteSpace: 'nowrap',
        background: active ? 'var(--accent-strong)' : 'transparent',
        color: active ? '#fff' : 'var(--text-dim)',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function segWrap(children: React.ReactNode) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--input-border)', background: 'var(--input-bg)' }}>
      {children}
    </div>
  );
}

/** The two ways a repeat can be expressed. */
type Mode = 'interval' | 'monthly';

const NTH_OPTS: { key: string; label: string }[] =
  ([1, 2, 3, 4, -1] as NthPosition[]).map(n => ({ key: String(n), label: NTH_LABEL[n] }));

/** Ordered so the common "weekday / weekend / any day" choices lead, then the
 *  seven named days. */
const KIND_OPTS: { key: DayKind; label: string }[] =
  (['weekday', 'weekend', 'day', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayKind[])
    .map(k => ({ key: k, label: KIND_LABEL[k] }));

const DEFAULT_RULE: MonthlyRule = { nth: 1, kind: 'mon' };

/**
 * Picks a recurrence. Three levels, in increasing specificity:
 *   Once  ·  Every N days/weeks/months  ·  On a calendar day of the month
 *
 * The last is the "first Monday" / "last weekday" / "second weekend day" family
 * that a plain interval can't express — a task tied to the shape of the month
 * rather than a fixed number of days. It emits a `monthlyRule`, which the stores
 * treat as outranking `recurring`/`intervalDays`.
 *
 * Controlled via `value`. Pass `repeatOnly` for tasks that must repeat.
 */
export function RepeatPicker({ value, onChange, repeatOnly = false }: {
  value: RepeatValue;
  onChange: (v: RepeatValue) => void;
  repeatOnly?: boolean;
}) {
  const init = decode(value.recurring, value.intervalDays);
  const [repeat, setRepeat] = useState(repeatOnly ? true : (init.repeat || !!value.monthlyRule));
  const [mode, setMode]     = useState<Mode>(value.monthlyRule ? 'monthly' : 'interval');
  const [count, setCount]   = useState(init.count);
  const [unit, setUnit]     = useState<Unit>(init.unit);
  // Kept while the user toggles modes, so switching away and back doesn't lose it.
  const [rule, setRule]     = useState<MonthlyRule>(value.monthlyRule ?? DEFAULT_RULE);

  /** Emit for the interval mode. */
  function emitInterval(next: { repeat?: boolean; count?: number; unit?: Unit }) {
    const on = next.repeat ?? repeat;
    if (!on) { onChange({ recurring: null, intervalDays: undefined, monthlyRule: null }); return; }
    onChange({ ...encode(next.count ?? count, next.unit ?? unit), monthlyRule: null });
  }

  /** Emit for the calendar-rule mode. `recurring` stays 'monthly' so anything
   *  reading only the coarse bucket still sees a monthly task. */
  function emitRule(next: Partial<MonthlyRule>) {
    const merged: MonthlyRule = { ...rule, ...next };
    // Stamp the anchor month the moment an interval > 1 is chosen, so "every 2
    // months" counts from now rather than from an arbitrary epoch.
    if ((merged.months ?? 1) > 1 && merged.anchorMonth === undefined) {
      merged.anchorMonth = currentMonthIndex();
    }
    setRule(merged);
    onChange({ recurring: 'monthly', intervalDays: undefined, monthlyRule: merged });
  }

  function switchMode(m: Mode) {
    setMode(m);
    if (m === 'monthly') emitRule({});
    else emitInterval({});
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!repeatOnly && segWrap(
          [false, true].map(r =>
            segBtn(repeat === r, () => {
              setRepeat(r);
              if (!r) onChange({ recurring: null, intervalDays: undefined, monthlyRule: null });
              else if (mode === 'monthly') emitRule({});
              else emitInterval({ repeat: true });
            }, r ? 'Repeat' : 'Once', String(r))
          )
        )}

        {repeat && segWrap([
          segBtn(mode === 'interval', () => switchMode('interval'), 'Every…', 'interval'),
          segBtn(mode === 'monthly',  () => switchMode('monthly'),  'On a day of the month', 'monthly'),
        ])}
      </div>

      {repeat && mode === 'interval' && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Every</span>
          <input
            type="number"
            min={1}
            className="rune-input"
            value={count}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              const c = isNaN(v) || v < 1 ? 1 : v;
              setCount(c);
              emitInterval({ count: c });
            }}
            style={{ width: 52, fontSize: 12, padding: '5px 6px', textAlign: 'center' }}
          />
          {segWrap(
            (['day', 'week', 'month'] as Unit[]).map(u =>
              segBtn(unit === u, () => { setUnit(u); emitInterval({ unit: u }); }, UNIT_LABEL[u], u)
            )
          )}
        </div>
      )}

      {repeat && mode === 'monthly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <MenuSelect
              label="Which"
              value={String(rule.nth)}
              options={NTH_OPTS}
              onChange={v => emitRule({ nth: Number(v) as NthPosition })}
            />
            <MenuSelect
              label="Day"
              value={rule.kind}
              options={KIND_OPTS}
              onChange={v => emitRule({ kind: v })}
            />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>of every</span>
            <input
              type="number"
              min={1}
              max={24}
              className="rune-input"
              value={rule.months ?? 1}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                const m = isNaN(v) || v < 1 ? 1 : Math.min(24, v);
                // Re-anchor whenever the interval changes, so the count always
                // starts from the month the user set it in.
                emitRule({ months: m, anchorMonth: m > 1 ? currentMonthIndex() : undefined });
              }}
              style={{ width: 52, fontSize: 12, padding: '5px 6px', textAlign: 'center' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              month{(rule.months ?? 1) > 1 ? 's' : ''}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
            ↻ {monthlyRuleLabel(rule)}
          </p>
        </div>
      )}
    </div>
  );
}

/** Compact "↻ Every 3 weeks" / "↻ 1st Monday" pill. Nothing for one-off tasks.
 *  A calendar rule gets the full sentence as its tooltip, since the badge itself
 *  is abbreviated to fit on a row. */
export function RecurrenceBadge({ recurring, intervalDays, monthlyRule, color = 'var(--accent)' }: {
  recurring: RecurringType | null | undefined;
  intervalDays?: number;
  monthlyRule?: MonthlyRule | null;
  color?: string;
}) {
  const label = recurrenceLabel({ recurring, intervalDays, monthlyRule });
  if (label === 'Once') return null;
  return (
    <span
      title={monthlyRule ? monthlyRuleLabel(monthlyRule) : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color }}
    >
      ↻ {label}
    </span>
  );
}
