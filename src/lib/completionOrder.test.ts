import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { completionOrder, automaticOrder } from './completionOrder';
import { useUIStore } from '../uiStore';
import { useQuestStore } from '../store';
import EditQuestlineModal from '../components/EditQuestlineModal';
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

it.each([false, true])('sorts completed quests last and restores manual order (Edit mode: %s)', async (editMode) => {
  const initial = useUIStore.getState();
  const line: Questline = { id: 'line', title: 'Line', description: '', icon: '', color: 'gold', quests: [
    { id: 'done', title: 'Done', description: '', order: 0, actions: [{ id: 'a', title: 'A', completed: true }] },
    { id: 'open', title: 'Open', description: '', order: 1, actions: [{ id: 'b', title: 'B', completed: false }] },
  ] };
  const host = document.createElement('div'), root = createRoot(host);
  const order = () => [...host.querySelectorAll('[data-quest-row]')].map(el => el.getAttribute('data-quest-row'));
  try {
    useUIStore.setState({ editMode });
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(QuestlineAccordionItem, { questline: line, isOpen: true, onToggle: () => {}, detail: true }))));
    expect(order()).toEqual(['open', 'done']);
    if (editMode) {
      expect(host.querySelector('[draggable="true"]')).toBeNull();
      expect(host.querySelector('[title="Drag to reorder"]')).toBeNull();
    }
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(QuestlineAccordionItem, { questline: { ...line, sortMode: 'manual' }, isOpen: true, onToggle: () => {}, detail: true }))));
    expect(order()).toEqual(['done', 'open']);
    if (editMode) expect(host.querySelectorAll('[draggable="true"]')).toHaveLength(2);
    expect(line.quests.map(q => q.id)).toEqual(['done', 'open']);
  } finally { await act(async () => root.unmount()); useUIStore.setState(initial); }
});

it('automatic mode orders by creation time within each completion group', () => {
  const items = [
    { id: 'new', createdAt: '2026-10-18T12:00:00Z', done: false },
    { id: 'checked', createdAt: '2026-01-01T12:00:00Z', done: true },
    { id: 'older', createdAt: '2026-10-01T12:00:00Z', done: false },
  ];
  expect(automaticOrder(items, x => x.done).map(x => x.id)).toEqual(['older', 'new', 'checked']);
});

it('saves sorting per questline and preserves legacy creation sequence after dragging', async () => {
  const initial = useQuestStore.getState();
  const line: Questline = { id: 'line', title: 'Line', description: '', icon: '', color: 'gold', quests: [
    { id: 'first', title: 'First', description: '', order: 0, actions: [] },
    { id: 'second', title: 'Second', description: '', order: 1, actions: [] },
  ] };
  useQuestStore.setState({ questlines: [line, { ...line, id: 'other' }] });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(EditQuestlineModal, { questline: line, onClose: () => {} })));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Manual')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')!.click());
    expect(useQuestStore.getState().questlines[0].sortMode).toBe('manual');
    expect(useQuestStore.getState().questlines[1].sortMode).toBeUndefined();
    await act(async () => useQuestStore.getState().reorderQuests('line', ['second', 'first']));
    const saved = useQuestStore.getState().questlines[0];
    expect(saved.quests.map(q => q.id)).toEqual(['second', 'first']);
    expect(automaticOrder(saved.quests, () => false).map(q => q.id)).toEqual(['first', 'second']);
  } finally { await act(async () => root.unmount()); useQuestStore.setState(initial); }
});
