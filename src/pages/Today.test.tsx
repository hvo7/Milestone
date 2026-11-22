import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Today from './Today';
import { dateKey, logicalDayStart, useQuestStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import type { Routine } from '../types';

vi.mock('../components/NavBar', () => ({ default: () => null }));
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useQuestStore.setState({ routines: [], questlines: [], systems: [], todoOrder: {}, completionLog: {} });
  useVynuesStore.setState({ projects: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const daily = (id: string, more: Partial<Routine> = {}): Routine =>
  ({ id, title: id, recurring: 'daily', trackedToday: false, completed: false, ...more });
const render = () => act(() => root.render(<MemoryRouter><Today /></MemoryRouter>));
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const checks = (selector: string) =>
  [...host.querySelectorAll<HTMLInputElement>(selector + ' input[type="checkbox"]')].map(c => c.getAttribute('aria-label'));
const click = (element: HTMLElement) => act(() => element.click());

it('puts the saved task order first and keeps habits exclusively in the side panel', () => {
  useQuestStore.setState({
    routines: [daily('Draft'), daily('Walk', { anchor: true }), daily('Read')],
    todoOrder: { Read: 0, Draft: 1 },
  });
  render();
  const list = host.querySelector('.agenda-list')!;
  const side = host.querySelector('.agenda-side')!;
  expect(list.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(checks('.agenda-list')).toEqual(['Read', 'Draft']);
  expect(checks('.agenda-habits')).toEqual(['Walk']);
  act(() => list.querySelector('[aria-label^="Reorder Draft"]')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
  ));
  expect(checks('.agenda-list')).toEqual(['Draft', 'Read']);
  click(host.querySelector<HTMLInputElement>('.agenda-list input[aria-label="Draft"]')!);
  expect(checks('.agenda-completed')).toEqual(['Draft']);
  expect(host.querySelector('progress')?.value).toBe(1);
  expect(host.querySelector('progress')?.max).toBe(3);
  click(host.querySelector('summary')!);
  click(host.querySelector<HTMLInputElement>('.agenda-completed input[aria-label="Draft"]')!);
  expect(useQuestStore.getState().routines.find(r => r.id === 'Draft')?.completed).toBe(false);
});

it('keeps day progress independent of task filters and excludes skipped work', () => {
  const sys = useQuestStore.getState().addSystem('Study');
  useQuestStore.setState({ routines: [
    daily('Read', { systemIds: [sys] }), daily('Walk', { anchor: true }),
    daily('Write', { completed: true, completedAt: new Date().toISOString() }),
    daily('Rest', { skippedOn: dateKey(logicalDayStart()) }),
  ] });
  render();
  click(button('Systems'));
  expect(checks('.agenda-list')).toEqual(['Read']);
  expect(checks('.agenda-habits')).toEqual(['Walk']);
  expect(host.querySelector('progress')?.value).toBe(1);
  expect(host.querySelector('progress')?.max).toBe(3);
  expect(host.querySelector('[aria-label^="Reorder "]')).toBeNull();
  click(button('All'));
  click(button('Show skipped · 1'));
  expect(checks('.agenda-list')).toContain('Rest');
  expect(host.querySelector('progress')?.max).toBe(3);
});

it('creates a task for the selected tomorrow and keeps it off today', async () => {
  render();
  click(button('Tomorrow'));
  const tomorrow = host.querySelector('time')!.dateTime;
  expect(host.querySelector('h1')?.textContent).toBe('Tomorrow');
  await act(async () => {
    button('+ New task').click();
    await import('../components/TaskCreateDrawer');
  });
  const field = host.querySelector<HTMLInputElement>('[placeholder="What needs doing?"]')!;
  expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(tomorrow);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Plan next week');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  click(button('Create task'));
  expect(checks('.agenda-list')).toContain('Plan next week');
  expect(host.querySelector<HTMLInputElement>('.agenda-list input[type="checkbox"]')?.disabled).toBe(true);
  click(button('Today'));
  expect(checks('.agenda-list')).not.toContain('Plan next week');
});

it('opens habit creation directly from the empty side panel', async () => {
  render();
  expect(host.textContent).toContain('No tasks scheduled for today.');
  expect(button('Explore example questlines')).toBeDefined();
  await act(async () => {
    button('+ Add habit').click();
    await import('../components/TaskCreateDrawer');
  });
  expect(button('Create habit')).toBeDefined();
  click(button('Cancel'));
  expect(useQuestStore.getState().routines).toHaveLength(0);
});

