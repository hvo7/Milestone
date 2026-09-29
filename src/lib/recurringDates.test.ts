import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { recurringDates } from './recurringDates';
import RecurringDates from '../components/RecurringDates';

const now = new Date(2026, 8, 29, 12);
describe('repeat date display', () => {
  it('shows daily current and next dates with the 2 AM boundary', () => {
    expect(recurringDates({ recurring: 'daily' }, now)).toEqual({ current: '2026-09-29', next: '2026-09-30' });
    expect(recurringDates({ recurring: 'daily' }, new Date(2026, 8, 29, 1))).toEqual({ current: '2026-09-28', next: '2026-09-29' });
  });
  it('shows Saturday deadlines for weekly cycles', () => {
    expect(recurringDates({ recurring: 'weekly' }, now)).toEqual({ current: '2026-10-03', next: '2026-10-10' });
  });
  it('leaves no current deadline after completion but preserves the next cycle', () => {
    expect(recurringDates({ recurring: 'weekly', completed: true }, now)).toEqual({ current: null, next: '2026-10-10' });
  });
  it('uses custom intervals ahead of their base cadence', () => {
    expect(recurringDates({ recurring: 'daily', intervalDays: 3, lastResetAt: now.toISOString() }, now)).toEqual({ current: '2026-10-01', next: '2026-10-04' });
  });
  it('uses actual monthly rules, with no current occurrence between dates', () => {
    const task = { monthlyRule: { nth: 1 as const, kind: 'mon' as const } };
    expect(recurringDates(task, now)).toEqual({ current: null, next: '2026-10-05' });
    expect(recurringDates(task, new Date(2026, 9, 5, 12))).toEqual({ current: '2026-10-05', next: '2026-11-02' });
  });
  it('matches the legacy 30-day cadence rather than inventing calendar months', () => {
    expect(recurringDates({ recurring: 'monthly', lastResetAt: now.toISOString() }, now)).toEqual({ current: '2026-10-29', next: '2026-11-28' });
  });
  it('does not invent dates when no schedule or interval anchor exists', () => {
    expect(recurringDates({}, now)).toEqual({ current: null, next: null });
    expect(recurringDates({ intervalDays: 3 }, now)).toEqual({ current: null, next: null });
    expect(recurringDates({ recurring: 'monthly', lastResetAt: 'invalid' }, now)).toEqual({ current: null, next: null });
  });
  it('renders both labels and the explicit None value', () => {
    const html = renderToStaticMarkup(createElement(RecurringDates, { task: { recurring: 'daily', completed: true }, now }));
    expect(html).toContain('Current due: None');
    expect(html).toContain('Next due: Sep 30, 2026');
  });
});
