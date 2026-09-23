import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDayClock, REFRESH_DAY_EVENT } from './dayClock';
import { logicalDateKey, nextDailyReset } from '../domain/schedule';

afterEach(() => { vi.useRealTimers(); });

describe('local day refresh', () => {
  it('refreshes exactly at 2 AM and supports manual refresh and waking', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 22, 1, 59, 59));
    const days: string[] = [];
    const stop = startDayClock(() => days.push(logicalDateKey()));
    expect(days).toEqual(['2026-09-21']);
    vi.advanceTimersByTime(1000);
    expect(days).toEqual(['2026-09-21', '2026-09-22']);
    window.dispatchEvent(new Event(REFRESH_DAY_EVENT));
    expect(days).toHaveLength(3);
    vi.setSystemTime(new Date(2026, 8, 23, 8));
    window.dispatchEvent(new Event('focus'));
    expect(days.at(-1)).toBe('2026-09-23');
    stop();
    window.dispatchEvent(new Event(REFRESH_DAY_EVENT));
    vi.advanceTimersByTime(60_000);
    expect(days).toHaveLength(4);
  });

  it('uses local calendar days around daylight saving transitions', () => {
    for (const [month, date] of [[2, 8], [10, 1]]) {
      const before = new Date(2026, month, date, 1, 59);
      const boundary = new Date(2026, month, date, 2);
      expect(nextDailyReset(before).getTime()).toBe(boundary.getTime());
      expect(logicalDateKey(before)).not.toBe(logicalDateKey(boundary));
      expect(nextDailyReset(boundary).getDate()).toBe(date + 1);
    }
  });
});
