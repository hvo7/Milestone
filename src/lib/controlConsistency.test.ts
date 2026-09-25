import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import QuestDoneToggle from '../components/QuestDoneToggle';
import PinButton from '../components/PinButton';
import QuestCreateDrawer from '../components/QuestCreateDrawer';
import NavBar from '../components/NavBar';
import { MemoryRouter } from 'react-router-dom';
import { useQuestStore } from '../store';
import { useVynuesStore, vynuesOnToday } from '../vynuesStore';
import { questShowsOnDay, actionShowsOnDay, vynuesShowsOnDay } from './today';
import type { Quest } from '../types';

afterEach(() => vi.useRealTimers());
const q: Quest = { id: 'q', title: 'Read', description: '', order: 0, actions: [] };
describe('consistent task controls', () => {
  it('opens the new quest form with no deadline and normal checklist completion', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(QuestCreateDrawer, { open: true, onClose: () => {}, initialQuestlineId: 'line' })));
      expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('');
      expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    } finally {
      await act(async () => root.unmount()); host.remove();
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
  it('has only Add new tab, Reload and Settings in the toolbar', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NavBar)));
    expect([...host.querySelectorAll('.nav-tools button')].map(b => b.getAttribute('aria-label'))).toEqual(['Add new tab', 'Reload tasks', 'Settings']);
  });
  it('renders manual and checklist quests with the same circular checkbox', () => {
    for (const completionMode of ['manual', 'steps'] as const) {
      const html = renderToStaticMarkup(createElement(QuestDoneToggle, { questlineId: 'line', quest: { ...q, completionMode } }));
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('rune-check');
      expect(html).not.toContain('<button');
    }
  });
  it('exposes an accessible, visible pin even before hover', () => {
    const html = renderToStaticMarkup(createElement(PinButton, { state: 'none', title: 'Pin to Today', onClick: () => {} }));
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Pin to Today"');
    expect(html).toContain('opacity:0.5');
  });
  it('unpins a quest due today and restores it on the next click', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 25, 12));
    useQuestStore.setState({ questlines: [{ id: 'line', title: 'Line', description: '', icon: '', color: '', quests: [{ ...q, dueDate: '2026-09-25' }] }] });
    const read = () => useQuestStore.getState().questlines[0].quests[0];
    useQuestStore.getState().toggleQuestTracked('line', 'q');
    expect(questShowsOnDay(read(), '2026-09-25')).toBe(false);
    useQuestStore.getState().toggleQuestTracked('line', 'q');
    expect(questShowsOnDay(read(), '2026-09-25')).toBe(true);
    expect(questShowsOnDay(read(), '2026-09-26')).toBe(false);
  });
  it('honors explicit unpin for daily actions and project tasks', () => {
    expect(actionShowsOnDay({ id: 'a', title: 'A', completed: false, recurring: 'daily', offToday: true }, new Date())).toBe(false);
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 25, 12));
    useVynuesStore.setState({ projects: [{ id: 'p', name: 'P', description: '', color: 'sapphire', status: 'active', createdAt: '', tasks: [{ id: 't', title: 'T', done: false, priority: 'medium', createdAt: '', recurring: 'daily' }] }] });
    const read = () => useVynuesStore.getState().projects[0].tasks[0];
    expect(vynuesOnToday(read())).toBe(true);
    useVynuesStore.getState().toggleTaskTracked('p', 't');
    expect(vynuesShowsOnDay(read(), '2026-09-25', new Date(2026, 8, 25))).toBe(false);
    useVynuesStore.getState().toggleTaskTracked('p', 't');
    expect(vynuesOnToday(read())).toBe(true);
  });
});
