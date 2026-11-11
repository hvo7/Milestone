import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { processQuestlines } from '../domain/taskState';
import { questShowsOnDay } from './today';
import { useQuestStore } from '../store';
import Today from '../pages/Today';
import type { Quest, Questline } from '../types';
const stamp = new Date(2026, 8, 25, 12).toISOString();
const q = (extra: Partial<Quest> = {}): Quest => ({ id: 'q', title: 'Pinned quest', description: '', order: 0, actions: [], trackedToday: true, completed: true, completedAt: stamp, ...extra });
const line = (quest: Quest): Questline => ({ id: 'l', title: 'Line', description: '', icon: '', color: 'sapphire', quests: [quest] });
afterEach(() => vi.useRealTimers());
it.each([
  q(), q({ completionMode: 'manual', actions: [{ id: 'a', title: 'Open preparation', completed: false }] }),
  q({ completed: false, completedAt: undefined, actions: [{ id: 'a', title: 'Step', completed: true, completedAt: stamp }] }),
])('keeps completion day, expires at reset, and persists unpin without erasing completion', quest => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 26, 1, 59));
  expect(processQuestlines([line(quest)])[0].quests[0].trackedToday).toBe(true);
  expect(questShowsOnDay(quest, '2026-09-25')).toBe(true);
  expect(questShowsOnDay(quest, '2026-09-26')).toBe(false);
  vi.setSystemTime(new Date(2026, 8, 26, 2));
  const result = processQuestlines([line(quest)])[0].quests[0];
  expect(result).toEqual({ ...quest, trackedToday: false });
});
it('keeps unfinished pins and clears completed pins before recurring resets', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 26, 12));
  expect(processQuestlines([line(q({ completed: false }))])[0].quests[0].trackedToday).toBe(true);
  const result = processQuestlines([line(q({ recurring: 'daily', lastResetAt: stamp }))])[0].quests[0];
  expect(result.trackedToday).toBe(false);
  expect(result.completed).toBe(false);
});
it.each([false, true])('unpins an existing Today quest (completed=%s) without deleting or completing it', async completed => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 25, 12));
  const quest = q({ completed });
  useQuestStore.setState({ questlines: [line(quest)], routines: [], systems: [] });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(Today))));
    const buttons = host.querySelectorAll<HTMLButtonElement>('button[aria-label="Unpin from Today"]');
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
    const saved = useQuestStore.getState().questlines[0].quests[0];
    expect(saved.completed).toBe(completed);
    expect(saved.trackedToday).toBe(false);
    expect(questShowsOnDay(saved, '2026-09-25')).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  }
});
