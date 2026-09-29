import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import QuestlineAccordionItem from '../components/QuestlineAccordionItem';
import NavBar from '../components/NavBar';
import { useQuestStore, useUIStore } from '../store';
import type { Questline } from '../types';

afterEach(() => vi.useRealTimers());

function pointer(target: EventTarget, type: string, y = 20, x = 20) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

it('clicks to edit, holds the active title to reorder, and cancels without saving', async () => {
  vi.useFakeTimers();
  const initial = useQuestStore.getState(), ui = useUIStore.getState();
  const line: Questline = { id: 'hold-line', title: 'Hold line', description: '', icon: '', color: 'gold', sequential: true,
    quests: ['First', 'Second', 'Third'].map((title, order) => ({ id: title, title, order, description: '', actions: [] })) };
  useQuestStore.setState({ questlines: [line] });
  useUIStore.setState({ editMode: false });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), edit = vi.fn();
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(QuestlineAccordionItem, { questline: line, isOpen: true, detail: true, onToggle: () => {}, onEditQuest: edit }))));
    const titles = [...host.querySelectorAll<HTMLButtonElement>('[data-reorder-handle]')];
    expect(titles.map(b => b.textContent)).toEqual(['First', 'Second', 'Third']);
    host.querySelectorAll<HTMLElement>('[data-quest-row]').forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 100, height: 80 } as DOMRect);
    });
    await act(async () => { pointer(titles[0], 'pointerdown'); pointer(window, 'pointerup'); titles[0].click(); });
    expect(edit).toHaveBeenCalledOnce(); edit.mockClear();
    await act(async () => { pointer(titles[0], 'pointerdown'); vi.advanceTimersByTime(179); });
    expect(document.body.classList.contains('reordering')).toBe(false);
    await act(async () => vi.advanceTimersByTime(1));
    expect(document.body.classList.contains('reordering')).toBe(true);
    await act(async () => pointer(window, 'pointermove', 290));
    expect(host.querySelector('[data-quest-row="Second"]')?.getAttribute('data-reorder-offset')).toBe('-100');
    expect(host.querySelector('[data-quest-row="Third"]')?.getAttribute('data-reorder-offset')).toBe('-100');
    expect(useQuestStore.getState().questlines[0].quests[0].id).toBe('First');
    await act(async () => pointer(window, 'pointermove', 20));
    expect(host.querySelector('[data-quest-row="Second"]')?.getAttribute('data-reorder-offset')).toBe('0');
    await act(async () => pointer(window, 'pointermove', 290));
    await act(async () => { pointer(window, 'pointerup', 290); titles[0].click(); });
    expect(edit).not.toHaveBeenCalled();
    const order = () => [...useQuestStore.getState().questlines[0].quests].sort((a, b) => a.order - b.order).map(q => q.id);
    expect(order()).toEqual(['Second', 'Third', 'First']);
    expect(document.body.classList.contains('reordering')).toBe(false);
    expect(host.querySelector('[data-quest-row="Second"]')?.getAttribute('data-reorder-offset')).toBe('0');
    await act(async () => { pointer(titles[1], 'pointerdown', 120); vi.advanceTimersByTime(350); });
    await act(async () => pointer(window, 'pointermove', 0));
    expect(host.querySelector('[data-quest-row="First"]')?.getAttribute('data-reorder-offset')).toBe('100');
    await act(async () => pointer(window, 'pointercancel'));
    expect(host.querySelector('[data-quest-row="First"]')?.getAttribute('data-reorder-offset')).toBe('0');
    expect(order()).toEqual(['Second', 'Third', 'First']);
    await act(async () => { pointer(titles[0], 'pointerdown'); pointer(window, 'pointermove', 20, 50); vi.advanceTimersByTime(350); });
    expect(document.body.classList.contains('reordering')).toBe(false);
    const pin = host.querySelector<HTMLButtonElement>('button[aria-pressed]')!;
    await act(async () => { pointer(pin, 'pointerdown'); vi.advanceTimersByTime(350); });
    expect(document.body.classList.contains('reordering')).toBe(false);
  } finally {
    await act(async () => root.unmount()); host.remove();
    useQuestStore.setState(initial); useUIStore.setState(ui);
  }
});

it('toggles theme from the main toolbar', async () => {
  const initial = useUIStore.getState();
  useUIStore.setState({ theme: 'light' });
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(NavBar))));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Use dark mode"]')!.click());
    expect(useUIStore.getState().theme).toBe('dark');
    expect(host.querySelector('[aria-label="Use light mode"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); useUIStore.setState(initial); }
});
