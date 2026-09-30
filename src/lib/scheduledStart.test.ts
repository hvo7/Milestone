import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { scheduledStart } from './scheduledStart';
import { recurringDates } from './recurringDates';
import { dueOnDay } from '../domain/schedule';
import { useQuestStore } from '../store';
import TaskCreateDrawer from '../components/TaskCreateDrawer';

afterEach(() => vi.useRealTimers());

it('anchors daily, weekly and custom repeats to the selected date and persists it', () => {
  const initial = useQuestStore.getState();
  try {
    for (const days of [1, 7, 14, 30]) {
      const schedule = scheduledStart({ recurring: 'weekly', intervalDays: days }, '2026-10-15');
      expect(dueOnDay(schedule, new Date(2026, 9, 14))).toBe(false);
      expect(dueOnDay(schedule, new Date(2026, 9, 15))).toBe(true);
      const id = useQuestStore.getState().addRoutine('Chosen date', '', schedule.recurring!, undefined, schedule.intervalDays, undefined, null, undefined, undefined, schedule.lastResetAt);
      const saved = useQuestStore.getState().routines.find(r => r.id === id)!;
      const expected = new Date(2026, 9, 15 + days, 12);
      const key = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`;
      expect(recurringDates(saved, new Date(2026, 9, 15, 12))).toEqual({ current: '2026-10-15', next: key });
      expect(saved.dueDate).toBeUndefined();
    }
  } finally { useQuestStore.setState(initial); }
});

it('lets a new weekly task change its date and saves the chosen cycle', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 30, 12));
  const initial = useQuestStore.getState();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const input = async (el: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(createElement(TaskCreateDrawer, { open: true, onClose: () => {} })));
    await input(host.querySelector('input[placeholder="What needs doing?"]')!, 'Weekly chosen date');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Repeat')!.click());
    const date = host.querySelector<HTMLInputElement>('[aria-label="Current due date"]')!;
    expect(date.readOnly).toBe(false);
    await input(date, '2026-10-08');
    expect(date.value).toBe('2026-10-08');
    expect(host.textContent).toContain(new Date(2026, 9, 15, 12).toLocaleDateString());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Create task')!.click());
    const saved = useQuestStore.getState().routines.find(r => r.title === 'Weekly chosen date')!;
    expect(saved.intervalDays).toBe(7);
    expect(recurringDates(saved, new Date(2026, 8, 30, 12))).toEqual({ current: '2026-10-08', next: '2026-10-15' });
  } finally { await act(async () => root.unmount()); host.remove(); useQuestStore.setState(initial); }
});
