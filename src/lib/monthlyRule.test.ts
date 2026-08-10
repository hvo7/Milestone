/**
 * Calendar-rule engine. This is the code most likely to be wrong in a way nobody
 * notices for a month — a rule that fires a day late, or skips a month, looks
 * exactly like "I forgot to do it".
 *
 * Dates are constructed with `new Date(y, m, d)` (local midnight) throughout,
 * matching what store.ts hands in after applying the 5am logical-day rollover.
 */
import { describe, it, expect } from 'vitest';
import {
  occurrenceInMonth, occursOn, lastOccurrenceOnOrBefore, nextOccurrenceAfter,
  monthlyRuleLabel, monthlyRuleShort, currentMonthIndex,
} from './monthlyRule';
import type { MonthlyRule } from '../types';

const at = (y: number, m: number, d: number) => new Date(y, m, d);
/** March 2026: 1st is a Sunday, 31 days. A month whose 1st is a Sunday is the
 *  interesting case for "first weekday" — it must skip to Monday the 2nd. */
const MAR = 2, JUN = 5, FEB = 1;

describe('occurrenceInMonth', () => {
  it('finds the nth specific weekday', () => {
    // March 2026: Mondays fall on 2, 9, 16, 23, 30.
    expect(occurrenceInMonth(2026, MAR, { nth: 1, kind: 'mon' })?.getDate()).toBe(2);
    expect(occurrenceInMonth(2026, MAR, { nth: 3, kind: 'mon' })?.getDate()).toBe(16);
    expect(occurrenceInMonth(2026, MAR, { nth: -1, kind: 'mon' })?.getDate()).toBe(30);
  });

  it('treats "day" as literally the nth day', () => {
    expect(occurrenceInMonth(2026, MAR, { nth: 1, kind: 'day' })?.getDate()).toBe(1);
    expect(occurrenceInMonth(2026, MAR, { nth: -1, kind: 'day' })?.getDate()).toBe(31);
  });

  it('skips the weekend for "first weekday" when the 1st is a Sunday', () => {
    // 1 Mar 2026 is a Sunday, so the first weekday is Monday the 2nd — the case
    // a naive "day 1" implementation gets wrong.
    expect(at(2026, MAR, 1).getDay()).toBe(0);
    expect(occurrenceInMonth(2026, MAR, { nth: 1, kind: 'weekday' })?.getDate()).toBe(2);
  });

  it('finds the last weekday when the month ends on a weekend', () => {
    // 31 May 2026 is a Sunday; the last weekday is Friday the 29th.
    expect(at(2026, 4, 31).getDay()).toBe(0);
    expect(occurrenceInMonth(2026, 4, { nth: -1, kind: 'weekday' })?.getDate()).toBe(29);
  });

  it('handles weekend days', () => {
    // March 2026 weekend days: 1(Sun), 7, 8, 14, 15, 21, 22, 28, 29.
    expect(occurrenceInMonth(2026, MAR, { nth: 1, kind: 'weekend' })?.getDate()).toBe(1);
    expect(occurrenceInMonth(2026, MAR, { nth: 2, kind: 'weekend' })?.getDate()).toBe(7);
    expect(occurrenceInMonth(2026, MAR, { nth: -1, kind: 'weekend' })?.getDate()).toBe(29);
  });

  it('copes with February in a non-leap year', () => {
    expect(occurrenceInMonth(2026, FEB, { nth: -1, kind: 'day' })?.getDate()).toBe(28);
  });

  it('returns the 29th for February in a leap year', () => {
    expect(occurrenceInMonth(2028, FEB, { nth: -1, kind: 'day' })?.getDate()).toBe(29);
  });
});

describe('monthActive / every N months', () => {
  const everyTwo = (anchorMonth: number): MonthlyRule =>
    ({ nth: 1, kind: 'mon', months: 2, anchorMonth });

  it('fires only in months matching the anchor stride', () => {
    const anchor = currentMonthIndex(at(2026, MAR, 1));   // March 2026
    const rule = everyTwo(anchor);
    expect(occursOn(at(2026, MAR, 2), rule)).toBe(true);   // anchor month
    expect(occursOn(at(2026, 3, 6), rule)).toBe(false);    // April — off-stride
    expect(occursOn(at(2026, 4, 4), rule)).toBe(true);     // May — on-stride
  });

  it('is stable for months before the anchor', () => {
    // A negative modulus must not flip the stride — Jan is two months before
    // March, so it is on-stride.
    const rule = everyTwo(currentMonthIndex(at(2026, MAR, 1)));
    expect(occursOn(at(2026, 0, 5), rule)).toBe(true);     // 5 Jan 2026 is a Monday
  });

  it('treats months:1 and an absent months identically', () => {
    expect(occursOn(at(2026, 3, 6), { nth: 1, kind: 'mon', months: 1 })).toBe(true);
    expect(occursOn(at(2026, 3, 6), { nth: 1, kind: 'mon' })).toBe(true);
  });
});

describe('occursOn', () => {
  const firstMonday: MonthlyRule = { nth: 1, kind: 'mon' };

  it('is true only on the exact date', () => {
    expect(occursOn(at(2026, MAR, 2), firstMonday)).toBe(true);
    expect(occursOn(at(2026, MAR, 1), firstMonday)).toBe(false);
    expect(occursOn(at(2026, MAR, 3), firstMonday)).toBe(false);
    expect(occursOn(at(2026, MAR, 9), firstMonday)).toBe(false); // second Monday
  });
});

describe('lastOccurrenceOnOrBefore', () => {
  const firstMonday: MonthlyRule = { nth: 1, kind: 'mon' };

  it('returns the same day when the date is itself an occurrence', () => {
    const got = lastOccurrenceOnOrBefore(at(2026, MAR, 2), firstMonday);
    expect(got?.getMonth()).toBe(MAR);
    expect(got?.getDate()).toBe(2);
  });

  it('walks back into the previous month when this month has not fired yet', () => {
    // 1 Mar is before this month's occurrence (the 2nd), so the answer is
    // February's first Monday — the 2nd.
    const got = lastOccurrenceOnOrBefore(at(2026, MAR, 1), firstMonday);
    expect(got?.getMonth()).toBe(FEB);
    expect(got?.getDate()).toBe(2);
  });

  it('respects the every-N-months stride when walking back', () => {
    const rule: MonthlyRule = { nth: 1, kind: 'mon', months: 2, anchorMonth: currentMonthIndex(at(2026, MAR, 1)) };
    // From April, the previous firing is March's — not April's.
    const got = lastOccurrenceOnOrBefore(at(2026, 3, 30), rule);
    expect(got?.getMonth()).toBe(MAR);
  });
});

describe('nextOccurrenceAfter', () => {
  const firstMonday: MonthlyRule = { nth: 1, kind: 'mon' };

  it('is strictly after the given date', () => {
    // Standing on the occurrence itself must advance to next month, otherwise a
    // task would be perpetually "due today".
    const got = nextOccurrenceAfter(at(2026, MAR, 2), firstMonday);
    expect(got?.getMonth()).toBe(3);
    expect(got?.getDate()).toBe(6);
  });

  it('finds this month when the occurrence is still ahead', () => {
    const got = nextOccurrenceAfter(at(2026, MAR, 1), firstMonday);
    expect(got?.getMonth()).toBe(MAR);
    expect(got?.getDate()).toBe(2);
  });

  it('crosses a year boundary', () => {
    const got = nextOccurrenceAfter(at(2026, 11, 25), firstMonday);
    expect(got?.getFullYear()).toBe(2027);
    expect(got?.getMonth()).toBe(0);
  });
});

describe('round trip', () => {
  it('last-then-next brackets any date', () => {
    const rule: MonthlyRule = { nth: 2, kind: 'weekend' };
    const day = at(2026, JUN, 17);
    const prev = lastOccurrenceOnOrBefore(day, rule)!;
    const next = nextOccurrenceAfter(day, rule)!;
    expect(prev.getTime()).toBeLessThanOrEqual(day.getTime());
    expect(next.getTime()).toBeGreaterThan(day.getTime());
    expect(occursOn(prev, rule)).toBe(true);
    expect(occursOn(next, rule)).toBe(true);
  });
});

describe('labels', () => {
  it('reads naturally', () => {
    expect(monthlyRuleLabel({ nth: 1, kind: 'mon' })).toBe('First Monday of the month');
    expect(monthlyRuleLabel({ nth: -1, kind: 'weekday' })).toBe('Last weekday of the month');
    expect(monthlyRuleLabel({ nth: 2, kind: 'weekend', months: 3 })).toBe('Second weekend day of every 3 months');
  });

  it('abbreviates for badges', () => {
    expect(monthlyRuleShort({ nth: 1, kind: 'mon' })).toBe('1st Mon');
    expect(monthlyRuleShort({ nth: -1, kind: 'weekday' })).toBe('Last weekday');
    expect(monthlyRuleShort({ nth: 3, kind: 'fri', months: 2 })).toBe('3rd Fri · every 2mo');
  });
});
