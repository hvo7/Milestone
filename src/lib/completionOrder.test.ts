import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { completionOrder } from './completionOrder';
import { useUIStore, UI_STORE_KEY } from '../uiStore';
import QuestlineAccordionItem from '../components/QuestlineAccordionItem';
import type { Questline } from '../types';

it('groups checked items stably without mutating manual order', () => {
  const items = [{ id: 'a', completed: true }, { id: 'b', completed: false }, { id: 'c', completed: true }, { id: 'd', completed: false }];
  expect(completionOrder(items, true, x => x.completed).map(x => x.id)).toEqual(['b', 'd', 'a', 'c']);
  expect(completionOrder(items, false, x => x.completed)).toEqual(items);
  expect(items.map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
  items[0].completed = false;
  expect(completionOrder(items, true, x => x.completed).map(x => x.id)).toEqual(['a', 'b', 'd', 'c']);
});

it('updates questline presentation and restores manual order when disabled', async () => {
  const initial = useUIStore.getState();
  const line: Questline = { id: 'line', title: 'Line', description: '', icon: '', color: 'gold', quests: [
    { id: 'done', title: 'Done', description: '', order: 0, actions: [{ id: 'a', title: 'A', completed: true }] },
    { id: 'open', title: 'Open', description: '', order: 1, actions: [{ id: 'b', title: 'B', completed: false }] },
  ] };
  const host = document.createElement('div'), root = createRoot(host);
  const order = () => [...host.querySelectorAll('[data-quest-row]')].map(el => el.getAttribute('data-quest-row'));
  try {
    useUIStore.setState({ completedLast: true, editMode: false });
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(QuestlineAccordionItem, { questline: line, isOpen: true, onToggle: () => {}, detail: true }))));
    expect(order()).toEqual(['open', 'done']);
    await act(async () => useUIStore.getState().setCompletedLast(false));
    expect(order()).toEqual(['done', 'open']);
    expect(line.quests.map(q => q.id)).toEqual(['done', 'open']);
    expect(JSON.parse(localStorage.getItem(UI_STORE_KEY)!).state.completedLast).toBe(false);
  } finally { await act(async () => root.unmount()); useUIStore.setState(initial); }
});
