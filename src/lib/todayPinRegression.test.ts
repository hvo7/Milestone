import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import TaskCreateDrawer from '../components/TaskCreateDrawer';
import { logicalDayStart, onToday, useQuestStore } from '../store';
import { useVynuesStore, vynuesOnToday } from '../vynuesStore';
import { questShowsOnDay, showsOnDay, vynuesShowsOnDay } from './today';
import type { Quest, Routine } from '../types';

const day = '2026-09-25';
const routine = (over: Partial<Routine> = {}): Routine => ({ id: 'r', title: 'General pin regression', recurring: null, completed: false, trackedToday: false, ...over });
const quest = (over: Partial<Quest> = {}): Quest => ({ id: 'q', title: 'Quest pin regression', description: '', order: 0, actions: [], ...over });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 25, 12));
  useQuestStore.setState({ routines: [], questlines: [], systems: [] });
  useVynuesStore.setState({ projects: [] });
});
afterEach(() => vi.useRealTimers());
async function renderToday() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(Today))));
    return host.textContent;
  } finally {
    await act(async () => root.unmount()); host.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  }
}

describe('Today pins and automatic deadlines', () => {
  it.each(['', day, '2026-09-26'])('creating a General task with deadline %s never accidentally unpins it', async dueDate => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(TaskCreateDrawer, { open: true, onClose: () => {} })));
      const setValue = async (input: HTMLInputElement, value: string) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      };
      await setValue(host.querySelector<HTMLInputElement>('input[placeholder="What needs doing?"]')!, 'Created general');
      if (dueDate) await setValue(host.querySelector<HTMLInputElement>('input[type="date"]')!, dueDate);
      const submit = [...host.querySelectorAll('button')].find(b => b.textContent === 'Create task')!;
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());
      const created = useQuestStore.getState().routines.find(r => r.title === 'Created general')!;
      expect(created).toBeDefined();
      expect(created.offToday).not.toBe(true);
      expect(showsOnDay(created, day, logicalDayStart())).toBe(dueDate !== '2026-09-26');
      expect(onToday(created)).toBe(dueDate !== '2026-09-26');
    } finally {
      await act(async () => root.unmount()); host.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
  it.each([null, '2026-09-24', '2026-09-26'])('pinning a General task with due date %s renders it immediately', async dueDate => {
    useQuestStore.setState({ routines: [routine({ dueDate })] });
    expect(await renderToday()).not.toContain('General pin regression');
    useQuestStore.getState().toggleRoutineTracked('r');
    const pinned = useQuestStore.getState().routines[0];
    expect(onToday(pinned)).toBe(true);
    expect(await renderToday()).toContain('General pin regression');
    expect(pinned.dueDate).toBe(dueDate); // Pinning must not rewrite the deadline.
    useQuestStore.getState().toggleRoutineTracked('r');
    expect(await renderToday()).not.toContain('General pin regression');
  });
  it('auto-pins due-today General tasks including legacy creation mistakes', async () => {
    for (const offToday of [undefined, true]) {
      const r = routine({ dueDate: day, offToday });
      useQuestStore.setState({ routines: [r] });
      expect(onToday(r)).toBe(true);
      expect(await renderToday()).toContain('General pin regression');
    }
  });
  it('honors a deliberate unpin today, and recovers automatically on a later due day', () => {
    useQuestStore.setState({ routines: [routine({ dueDate: day })] });
    useQuestStore.getState().toggleRoutineTracked('r');
    const r = useQuestStore.getState().routines[0];
    expect(showsOnDay(r, day, logicalDayStart())).toBe(false);
    expect(showsOnDay({ ...r, dueDate: '2026-09-26' }, '2026-09-26', new Date(2026, 8, 26))).toBe(true);
  });
  it('auto-pins quest and project deadlines without turning on a permanent manual pin', () => {
    const q = quest({ dueDate: day, offToday: true });
    expect(questShowsOnDay(q, day)).toBe(true);
    expect(questShowsOnDay(q, '2026-09-26')).toBe(false);
    const t = { id: 't', title: 'Project', done: false, priority: 'medium' as const, createdAt: '', dueDate: day, offToday: true };
    expect(vynuesOnToday(t)).toBe(true);
    expect(vynuesShowsOnDay(t, day, logicalDayStart())).toBe(true);
    expect(vynuesShowsOnDay(t, '2026-09-26', new Date(2026, 8, 26))).toBe(false);
  });
  it('lights future quest and project pins and shows their rows after clicking', async () => {
    const q = quest({ dueDate: '2026-09-26' });
    useQuestStore.setState({ questlines: [{ id: 'line', title: 'Line', description: '', icon: '', color: '', quests: [q] }] });
    useQuestStore.getState().toggleQuestTracked('line', 'q');
    expect(await renderToday()).toContain('Quest pin regression');
    const t = { id: 't', title: 'Project pin regression', done: false, priority: 'medium' as const, createdAt: '', dueDate: '2026-09-26' };
    useVynuesStore.setState({ projects: [{ id: 'p', name: 'P', description: '', color: 'sapphire', status: 'active', createdAt: '', tasks: [t] }] });
    useVynuesStore.getState().toggleTaskTracked('p', 't');
    expect(vynuesOnToday(useVynuesStore.getState().projects[0].tasks[0])).toBe(true);
    expect(await renderToday()).toContain('Project pin regression');
  });
  it('auto-pins at the local 2 AM day boundary, not midnight', () => {
    const r = routine({ dueDate: day });
    vi.setSystemTime(new Date(2026, 8, 25, 1, 59));
    expect(onToday(r)).toBe(false);
    vi.setSystemTime(new Date(2026, 8, 25, 2));
    expect(onToday(r)).toBe(true);
  });
});
