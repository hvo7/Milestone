import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Today from './Today';
import { dateKey, logicalDayStart, useQuestStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import type { Routine } from '../types';
import { UI_STORE_KEY, useUIStore } from '../uiStore';
import UndoToast from '../components/UndoToast';
import { useUndoStore } from '../lib/undo';

vi.mock('../components/NavBar', () => ({ default: () => null }));
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no native dialog top layer. Track open/close for these DOM journeys.
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) { this.open = true; },
    close(this: HTMLDialogElement) { this.open = false; },
  });
  useQuestStore.setState({ routines: [], questlines: [], systems: [], todoOrder: {}, completionLog: {} });
  useVynuesStore.setState({ projects: [] });
  useUIStore.setState({ hiddenAgendaRows: undefined });
  useUndoStore.getState().dismiss();
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
const render = () => act(() => root.render(<MemoryRouter><Today inlineAgenda={false} /></MemoryRouter>));
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const checks = (selector: string) =>
  [...host.querySelectorAll<HTMLInputElement>(selector + ' input[type="checkbox"]')].map(c => c.getAttribute('aria-label'));
const click = (element: HTMLElement) => act(() => element.click());

const renderInline = () => act(() => root.render(<MemoryRouter><Today inlineAgenda /><UndoToast /></MemoryRouter>));
const titleButton = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('.inline-title')].find(b => b.textContent === name)!;
const optionButton = () => host.querySelector<HTMLButtonElement>('[aria-label="List options"]')!;
const currentRow = () => host.querySelector<HTMLDivElement>('.inline-item[data-expanded="true"]')!;
const key = (el: Element, value: string) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
});
function enterText(field: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('opens one inline row, toggles and adds steps, and returns focus to the title with Escape', () => {
  useQuestStore.setState({ routines: [daily('Study'), daily('Read', { anchor: true })] });
  useQuestStore.getState().addRoutineSubtask('Study', 'Fit the model');
  useQuestStore.getState().addRoutineSubtask('Study', 'Interpret the coefficients');
  renderInline();
  expect(host.querySelector('.agenda-inline')).toBeTruthy();
  expect(button('Edit')).toBeUndefined();
  click(titleButton('Study'));
  const sub = currentRow().querySelector<HTMLInputElement>('input[aria-label="Fit the model"]')!;
  click(sub);
  expect(sub.checked).toBe(true);
  click(currentRow().querySelector('summary')!);
  click(button('Add step'));
  const field = currentRow().querySelector<HTMLInputElement>('input.rune-input')!;
  enterText(field, 'Check residuals');
  key(field, 'Enter');
  expect(currentRow().querySelector('[aria-label="Check residuals"]')).toBeTruthy();
  click(titleButton('Read'));
  expect(titleButton('Study').getAttribute('aria-expanded')).toBe('false');
  key(titleButton('Read'), 'Escape');
  expect(document.activeElement).toBe(titleButton('Read'));
  click(titleButton('Study'));
  expect(currentRow().querySelector<HTMLInputElement>('[aria-label="Fit the model"]')!.checked).toBe(true);
});

it('removes for this day only, supports Undo and restores the saved order after rehydration', async () => {
  useQuestStore.setState({ routines: [daily('Study'), daily('Walk')], todoOrder: { Study: 1, Walk: 0 } });
  renderInline();
  click(titleButton('Study'));
  click(button('Remove'));
  expect(useQuestStore.getState().routines.map(r => r.id)).toContain('Study');
  expect(useUIStore.getState().hiddenAgendaRows?.ids).toEqual(['Study']);
  click(button('Undo'));
  expect(useUIStore.getState().hiddenAgendaRows?.ids).toEqual([]);
  click(titleButton('Study'));
  click(button('Remove'));
  const saved = localStorage.getItem(UI_STORE_KEY)!;
  act(() => root.unmount());
  useUIStore.setState({ hiddenAgendaRows: undefined });
  localStorage.setItem(UI_STORE_KEY, saved);
  await useUIStore.persist.rehydrate();
  root = createRoot(host);
  renderInline();
  expect(titleButton('Study')).toBeUndefined();
  click(optionButton());
  click(button('Tomorrow'));
  expect(titleButton('Study')).toBeDefined();
  click(titleButton('Study'));
  expect(currentRow().querySelector('.inline-actions')).toBeNull();
  expect(currentRow().querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  click(button('Today'));
  click(button('Restore Study'));
  expect(checks('.agenda-list')).toEqual(['Walk', 'Study']);
  key(host.querySelector('#agenda-options')!, 'Escape');
  expect(optionButton().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(optionButton());
});

it('creates, cancels, edits and reopens real tasks from the reference layout', async () => {
  renderInline();
  button('+ New task').focus();
  await act(async () => { button('+ New task').click(); await import('../components/TaskCreateDrawer'); });
  expect(host.querySelector('dialog[open]')?.getAttribute('aria-label')).toBe('New task');
  click(button('Create task'));
  expect(useQuestStore.getState().routines).toHaveLength(0);
  enterText(host.querySelector<HTMLInputElement>('[placeholder="What needs doing?"]')!, 'Write results');
  click(button('Create task'));
  expect(document.activeElement).toBe(button('+ New task'));
  click(titleButton('Write results'));
  await act(async () => { button('Edit').click(); await import('../components/TaskEditDrawer'); });
  const editorField = () => [...host.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === 'Write results')!;
  enterText(editorField(), 'Discard me');
  click(button('Cancel'));
  expect(titleButton('Write results')).toBeDefined();
  click(button('Edit'));
  enterText(editorField(), 'Revise results');
  click(button('Save changes'));
  expect(titleButton('Revise results')).toBeDefined();
  click(host.querySelector<HTMLInputElement>('.inline-check-target input[aria-label="Revise results"]')!);
  const completed = host.querySelector<HTMLDetailsElement>('.agenda-completed')!;
  click(completed.querySelector('summary')!);
  click(completed.querySelector<HTMLInputElement>('input')!);
  expect(checks('.agenda-list')).toContain('Revise results');
  click(button('+ Add habit'));
  enterText(host.querySelector<HTMLInputElement>('[placeholder="What needs doing?"]')!, 'Walk daily');
  click(button('Create habit'));
  expect(checks('.agenda-habits')).toContain('Walk daily');
});

it('keeps filters, system assignment, skip, counters, keyboard ordering and day progress usable', () => {
  const studySystem = useQuestStore.getState().addSystem('Study');
  useQuestStore.setState({ routines: [daily('A'), daily('B', { target: 4, step: 1, progress: 0, unit: 'sets' })] });
  renderInline();
  key(host.querySelector('[aria-label^="Reorder B"]')!, 'ArrowUp');
  expect(checks('.agenda-list')).toEqual(['B', 'A']);
  click(titleButton('B'));
  click(currentRow().querySelector<HTMLButtonElement>('[aria-label="2 sets"]')!);
  expect(useQuestStore.getState().routines.find(r => r.id === 'B')?.progress).toBe(2);
  click(titleButton('A'));
  click(currentRow().querySelector<HTMLButtonElement>('[title="Change which systems this belongs to"]')!);
  click(currentRow().querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!);
  expect(useQuestStore.getState().routines.find(r => r.id === 'A')?.systemIds).toContain(studySystem);
  click(optionButton());
  click(button('Systems'));
  expect(checks('.agenda-list')).toEqual(['A']);
  click(button('All'));
  click(currentRow().querySelector('summary')!);
  click(currentRow().querySelector<HTMLButtonElement>('details button:last-child')!);
  expect(host.querySelector('progress')!.max).toBe(1);
  click(host.querySelector<HTMLButtonElement>('.agenda-skipped')!);
  expect(checks('.agenda-list')).toContain('A');
  if (titleButton('A').getAttribute('aria-expanded') === 'false') click(titleButton('A'));
  if (!currentRow().querySelector('details')!.open) click(currentRow().querySelector('summary')!);
  click(currentRow().querySelector<HTMLButtonElement>('details button:last-child')!);
  expect(host.querySelector('progress')!.max).toBe(2);
});

it('opens quest, action and project rows with their own editor and preserves their source on removal', async () => {
  const qs = useQuestStore.getState();
  qs.addQuestline('Course', '', '', 'sapphire');
  const qlId = useQuestStore.getState().questlines[0].id;
  qs.addQuest(qlId, 'Coursework', '', null, null);
  const questId = useQuestStore.getState().questlines[0].quests[0].id;
  qs.addAction(qlId, questId, 'Write proof');
  qs.toggleQuestTracked(qlId, questId);
  const vs = useVynuesStore.getState();
  vs.addProject('Thesis', '', 'sapphire');
  const projectId = useVynuesStore.getState().projects[0].id;
  vs.addTask(projectId, 'Publish draft', 'medium', null, null, undefined, '', true, ['Proofread', 'Read aloud']);
  renderInline();
  click(titleButton('Coursework'));
  expect(currentRow().querySelector('[aria-label="Write proof"]')).toBeTruthy();
  await act(async () => { button('Edit').click(); await import('../components/QuestCreateDrawer'); });
  click(button('Cancel'));
  // Unpin is on the row itself, not behind More (released in 3.3.13).
  click(currentRow().querySelector('[aria-label="Unpin from Today"]')!);
  const actionId = useQuestStore.getState().questlines[0].quests[0].actions[0].id;
  act(() => qs.toggleTracked(qlId, questId, actionId));
  click(titleButton('Write proof'));
  await act(async () => {
    titleButton('Write proof').closest('.inline-item')!.querySelector<HTMLButtonElement>('.inline-actions button')!.click();
    await import('../components/TaskEditDrawer');
  });
  expect(button('Delete action')).toBeDefined();
  click(button('Cancel'));
  click(currentRow().querySelector<HTMLButtonElement>('[title="Remove from today’s list"]')!);
  expect(useQuestStore.getState().questlines[0].quests[0].actions[0].id).toBe(actionId);
  click(titleButton('Publish draft'));
  click(currentRow().querySelector<HTMLInputElement>('[aria-label="Proofread"]')!);
  expect(currentRow().querySelector<HTMLInputElement>('[aria-label="Proofread"]')!.checked).toBe(true);
  click(currentRow().querySelector<HTMLButtonElement>('.inline-actions button')!);
  expect(button('Save changes')).toBeDefined();
  key(document.body, 'Escape');
  expect(host.querySelector('dialog[open]')).toBeNull();
});

it('edits nested steps, adjusts a continuous counter and logs a session directly in the agenda', () => {
  useQuestStore.setState({ routines: [
    daily('Read', { target: 100, progress: 0, unit: 'pages', step: 1 }),
    daily('Gym', { anchor: true, recurring: 'weekly', target: 3, oncePerDay: true }),
  ] });
  useQuestStore.getState().addRoutineSubtask('Read', 'Chapter');
  renderInline();
  click(titleButton('Read'));
  const inRow = (selector: string) => currentRow().querySelector<HTMLElement>(selector)!;
  click(inRow('button[title="+1"]'));
  expect(useQuestStore.getState().routines[0].progress).toBe(1);
  click(inRow('button[title="−1"]'));
  click(inRow('[aria-label="Break this step down further"]'));
  const addChild = inRow('[placeholder^="A smaller step"]') as HTMLInputElement;
  enterText(addChild, 'Make notes');
  key(addChild, 'Enter');
  const child = () => currentRow().querySelector<HTMLInputElement>('input[aria-label="Make notes"]')!.closest('.subtask-row')!;
  click(child().querySelector<HTMLButtonElement>('[aria-label="Rename step"]')!);
  const rename = inRow('.subtask-row input.rune-input') as HTMLInputElement;
  enterText(rename, 'Summarize');
  key(rename, 'Enter');
  const renamed = inRow('input[aria-label="Summarize"]').closest('.subtask-row')!;
  click(renamed.querySelector<HTMLButtonElement>('[aria-label="Delete step"]')!);
  expect(useQuestStore.getState().routines[0].subtasks?.[0].children ?? []).toHaveLength(0);
  click(titleButton('Gym'));
  const session = inRow('.task-progress-strip button[aria-label*="(today)"]');
  click(session);
  expect(useQuestStore.getState().routines[1].sessionDays).toContain(dateKey(logicalDayStart()));
  click(session);
  expect(useQuestStore.getState().routines[1].sessionDays ?? []).not.toContain(dateKey(logicalDayStart()));
  const history = host.querySelector<HTMLDetailsElement>('.agenda-history')!;
  click(history.querySelector('summary')!);
  expect(history.open).toBe(true);
  click(history.querySelector('summary')!);
  expect(history.open).toBe(false);
});

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

