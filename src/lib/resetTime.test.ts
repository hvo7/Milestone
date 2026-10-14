import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useUIStore, UI_STORE_KEY, resetMinutes, atResetTime } from '../uiStore';
import { logicalDateKey, nextDailyReset, periodExpired } from '../domain/schedule';
import { startDayClock } from './dayClock';
import SettingsModal from '../components/SettingsModal';

const initial = useUIStore.getState();
afterEach(() => { useUIStore.setState(initial); vi.useRealTimers(); });

it('saves a valid local time and rejects invalid values', () => {
  useUIStore.getState().setResetTime('05:45');
  expect(resetMinutes()).toBe(345);
  expect(JSON.parse(localStorage.getItem(UI_STORE_KEY)!).state.resetTime).toBe('05:45');
  useUIStore.getState().setResetTime('24:00');
  expect(resetMinutes()).toBe(345);
});

it('uses the chosen hour and minute, including midnight and late evening', () => {
  for (const time of ['00:00', '05:45', '23:59']) {
    useUIStore.getState().setResetTime(time);
    const boundary = atResetTime(new Date(2026, 9, 14, 12));
    const before = new Date(boundary.getTime() - 1);
    expect(logicalDateKey(before)).toBe('2026-10-13');
    expect(logicalDateKey(boundary)).toBe('2026-10-14');
    expect(nextDailyReset(before)).toEqual(boundary);
    expect(nextDailyReset(boundary).getDate()).toBe(15);
    expect(periodExpired({ recurring: 'daily', lastResetAt: before.toISOString() }, boundary)).toBe(true);
  }
});

it('reschedules the live clock when the setting changes', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 14, 5, 44, 59));
  const refresh = vi.fn();
  const stop = startDayClock(refresh);
  try {
    useUIStore.getState().setResetTime('05:45');
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(logicalDateKey()).toBe('2026-10-14');
  } finally { stop(); }
});

it('exposes an explicit save control in General settings', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(SettingsModal, { onClose: vi.fn(), notifications: 'Off', onNotifications: vi.fn(), onData: vi.fn(), onNotion: vi.fn(), desktop: false })));
    const input = host.querySelector<HTMLInputElement>('#goal-reset-time')!;
    expect(input.value).toBe('02:00');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '06:30');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useUIStore.getState().resetTime).toBe('02:00');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save reset time')!.click());
    expect(useUIStore.getState().resetTime).toBe('06:30');
  } finally { await act(async () => root.unmount()); }
});
