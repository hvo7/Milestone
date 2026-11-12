import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StatusLifeVitalsPage, { StatusAreaEditor, StatusAreaFocus } from './StatusLifeVitalsPage';
import { newStatusVital, saveCheckIn, statusVitalsKey, type StatusVital } from '../lib/statusVitals';

vi.mock('../components/NavBar', () => ({ default: () => null }));
let root: Root;
let host: HTMLDivElement;
const area = () => ({ ...newStatusVital(), name: 'School', onPace: 'Review lectures within two days' });
const origin = { left: 0, top: 0, width: 100, height: 100 };
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = (element: Element) => act(() => (element as HTMLElement).click());
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const renderFocus = (a = area(), save = vi.fn<(a: StatusVital) => boolean>(() => true), close = vi.fn()) => {
  act(() => root.render(<StatusAreaFocus area={a} origin={origin} onSave={save} onClose={close} onEdit={() => {}} />));
  return { save, close };
};

it('requires a status, adapts the note label, and saves the reason and next step', () => {
  const { save, close } = renderFocus();
  expect(host.querySelectorAll('input[type=radio]')).toHaveLength(3);
  expect(host.querySelectorAll('input[type=number], input[type=checkbox]')).toHaveLength(0);
  click(button('Save check-in'));
  expect(save).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Choose a status');
  click(host.querySelector('input[value=behind]')!);
  expect(host.textContent).toContain('What’s holding you back?');
  type(host.querySelector('textarea')!, 'Two lectures behind');
  type(host.querySelector('.lv-status-form > label input')!, 'Review tonight');
  click(button('Save check-in'));
  expect(save.mock.calls[0][0].entries[0]).toMatchObject({ status: 'behind', reason: 'Two lectures behind', next: 'Review tonight' });
  expect(close).toHaveBeenCalledOnce();
});

it('edits a history entry without creating a duplicate or changing the latest status', () => {
  const first = saveCheckIn(area(), { status: 'behind', reason: 'Busy', next: '' }, undefined, '2026-11-09T12:00:00Z');
  const second = saveCheckIn(first, { status: 'ahead', reason: 'Finished early', next: '' }, undefined, '2026-11-10T12:00:00Z');
  const { save } = renderFocus(second);
  click(host.querySelector('summary')!);
  const edits = host.querySelectorAll('.lv-status-history button');
  click(edits[1]);
  expect(host.querySelector('textarea')?.value).toBe('Busy');
  type(host.querySelector('textarea')!, 'Exam week');
  click(button('Save changes'));
  const updated = save.mock.calls[0][0];
  expect(updated.entries).toHaveLength(2);
  expect(updated.entries[1]).toMatchObject({ id: first.entries[0].id, createdAt: '2026-11-09T12:00:00Z', reason: 'Exam week' });
  expect(updated.entries[0].status).toBe('ahead');
});

it('keeps failed saves open and closing cancels the draft', () => {
  const original = area();
  const { save, close } = renderFocus(original, vi.fn(() => false));
  click(host.querySelector('input[value="on-pace"]')!);
  click(button('Save check-in'));
  expect(save).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Could not save');
  click(host.querySelector('[aria-label="Close life area"]')!);
  expect(close).toHaveBeenCalledOnce();
  expect(original.entries).toHaveLength(0);
});

it('lets the user rename and define an area without losing its history', () => {
  const original = saveCheckIn(area(), { status: 'on-pace', reason: 'Done', next: '' });
  const save = vi.fn<(a: StatusVital) => boolean>(() => true);
  act(() => root.render(<StatusAreaEditor area={original} isNew={false} onSave={save} onClose={() => {}} onArchive={() => true} />));
  expect(host.querySelectorAll('input, textarea')).toHaveLength(2);
  type(host.querySelector('input')!, 'My classes');
  type(host.querySelector('textarea')!, 'Stay within one lecture');
  click(button('Save changes'));
  expect(save.mock.calls[0][0]).toMatchObject({ name: 'My classes', onPace: 'Stay within one lecture', entries: original.entries });
});

it('persists a check-in through the full page and retains it after remount', () => {
  const key = statusVitalsKey(false);
  localStorage.setItem(key, JSON.stringify([area()]));
  act(() => root.render(<StatusLifeVitalsPage />));
  click(host.querySelector('.lv-region')!);
  click(host.querySelector('input[value=behind]')!);
  type(host.querySelector('textarea')!, 'Need more time');
  click(button('Save check-in'));
  expect(JSON.parse(localStorage.getItem(key)!)[0].entries[0].reason).toBe('Need more time');
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<StatusLifeVitalsPage />));
  expect(host.querySelector('.lv-region')?.getAttribute('aria-label')).toContain('Behind');
  expect(host.querySelector('time')).not.toBeNull();
});

it('shows the latest saved check-in without changing it when a new status is selected', () => {
  const first = saveCheckIn(area(), { status: 'behind', reason: 'Older note', next: '' }, undefined, '2026-11-09T12:00:00Z');
  const second = saveCheckIn(first, { status: 'on-pace', reason: 'Caught up', next: 'Review tomorrow' }, undefined, '2026-11-10T12:00:00Z');
  // Editing an older record must not make it the last check-in.
  const edited = saveCheckIn(second, { status: 'behind', reason: 'Corrected older note', next: '' }, first.entries[0].id, '2026-11-11T12:00:00Z');
  const { save } = renderFocus(edited);
  click(button('New check-in'));
  const panel = host.querySelector<HTMLElement>('#lv-last-check-in')!;
  expect(panel.hidden).toBe(true);
  click(button('Show last check-in'));
  expect(panel.hidden).toBe(false);
  expect(button('Hide last check-in').getAttribute('aria-expanded')).toBe('true');
  expect(panel.querySelector('.lv-badge')?.textContent).toContain('On pace');
  expect(panel.querySelector('time')?.dateTime).toBe('2026-11-10T12:00:00Z');
  expect(panel.textContent).toContain('Caught up');
  expect(panel.textContent).toContain('Review tomorrow');
  expect(panel.textContent).not.toContain('Corrected older note');
  click(host.querySelector('input[value=ahead]')!);
  expect(panel.querySelector('.lv-badge')?.textContent).toContain('On pace');
  expect(save).not.toHaveBeenCalled();
  click(button('Hide last check-in'));
  expect(panel.hidden).toBe(true);
});

it('shows an empty state when there has not been a check-in', () => {
  renderFocus();
  click(button('Show last check-in'));
  expect(host.querySelector('#lv-last-check-in')?.textContent).toBe('No check-ins yet.');
});

it('advances the sidebar ASAP item when the top unfinished task is completed', () => {
  const a = saveCheckIn({ ...area(), plans: { catchUp: { sequential: false, tasks: [
    { id: 'one', title: 'Review notes', done: false, subtasks: [] },
    { id: 'two', title: 'Practice questions', done: false, subtasks: [] },
  ] }, maintenance: { sequential: false, tasks: [] } } }, { status: 'behind', reason: '', next: '' });
  localStorage.setItem(statusVitalsKey(false), JSON.stringify([a]));
  act(() => root.render(<StatusLifeVitalsPage />));
  expect(host.querySelector('.lv-attention-asap')?.textContent).toBe('ASAPReview notes');
  click(host.querySelector('.lv-attention-item')!);
  click(host.querySelector('[aria-label="Complete Review notes"]')!);
  expect(host.querySelector('.lv-attention-asap')?.textContent).toBe('ASAPPractice questions');
  click(host.querySelector('[aria-label="Complete Practice questions"]')!);
  expect(host.querySelector('.lv-attention-asap')).toBeNull();
  expect(host.querySelector('.lv-attention-reason')?.textContent).toBe('Behind');
});

it.each(['behind', 'on-pace'] as const)('reopens %s with its saved checklist and separates new check-ins', savedStatus => {
  const original = saveCheckIn(area(), { status: savedStatus, reason: 'Saved note', next: '' });
  const key = statusVitalsKey(false);
  localStorage.setItem(key, JSON.stringify([original]));
  act(() => root.render(<StatusLifeVitalsPage />));
  click(host.querySelector('.lv-region')!);
  expect(host.querySelector('.lv-checklist h3')?.textContent).toBe(savedStatus === 'behind' ? 'Get back on pace' : 'Keep on pace');
  expect(host.querySelector('.lv-status-form')).toBeNull();
  click(button('+ Add task'));
  type(host.querySelector('.lv-plan-editor input')!, 'Saved action'); click(button('Save item'));
  click(host.querySelector('[aria-label="Complete Saved action"]')!);
  expect(JSON.parse(localStorage.getItem(key)!)[0].entries).toEqual(original.entries);
  click(button('New check-in'));
  expect(host.querySelector('input[type=radio]:checked')).toBeNull();
  expect(host.querySelector('.lv-checklist')).toBeNull();
  click(host.querySelector('input[value=behind]')!);
  expect(host.querySelector('.lv-checklist')).not.toBeNull();
  click(button('Cancel check-in'));
  expect(host.querySelector<HTMLInputElement>('[aria-label="Complete Saved action"]')!.checked).toBe(true);
  click(host.querySelector('[aria-label="Close life area"]')!);
  click(host.querySelector('.lv-region')!);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Complete Saved action"]')!.checked).toBe(true);
});

it('places status first and reveals only its matching checklist directly beneath it', () => {
  renderFocus(saveCheckIn(area(), { status: 'ahead', reason: '', next: '' }));
  click(button('New check-in'));
  const title = host.querySelector('#status-focus-title')!;
  const choices = host.querySelector('.lv-status-options')!;
  expect(title.nextElementSibling).toBe(choices);
  expect(host.querySelector('input[type=radio]:checked')).toBeNull();
  expect(host.querySelector('.lv-checklist')).toBeNull();
  expect(host.querySelector('[aria-label="Checklist type"]')).toBeNull();
  click(host.querySelector('input[value=behind]')!);
  expect(choices.nextElementSibling).toBe(host.querySelector('.lv-checklist'));
  expect(host.querySelector('.lv-checklist h3')?.textContent).toBe('Get back on pace');
  click(host.querySelector('input[value="on-pace"]')!);
  expect(host.querySelector('.lv-checklist h3')?.textContent).toBe('Keep on pace');
  click(host.querySelector('input[value=ahead]')!);
  expect(host.querySelector('.lv-checklist')).toBeNull();
});

it('shows attention beside all areas and persists, replaces, and clears one current priority', () => {
  const key = statusVitalsKey(false);
  const fresh = saveCheckIn({ ...area(), name: 'Gym' }, { status: 'on-pace', reason: '', next: '' });
  const behind = saveCheckIn(area(), { status: 'behind', reason: '', next: '' });
  localStorage.setItem(key, JSON.stringify([fresh, behind]));
  act(() => root.render(<StatusLifeVitalsPage />));
  const setPriority = (id: string) => act(() => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Current priority"]')!;
    select.value = id; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  setPriority(behind.id);
  expect(host.querySelector('.lv-region')?.textContent).toContain('School');
  setPriority(fresh.id);
  expect(JSON.parse(localStorage.getItem(key)!).filter((a: StatusVital) => a.priority).map((a: StatusVital) => a.name)).toEqual(['Gym']);
  expect(host.querySelectorAll('.lv-region')).toHaveLength(2);
  expect(host.querySelectorAll('.lv-attention-item')).toHaveLength(1);
  expect(host.querySelector('.lv-attention-panel')?.textContent).toContain('School');
  expect(host.querySelector('.lv-attention-panel')?.textContent).not.toContain('Gym');
  click(host.querySelector('[aria-label="Review School"]')!);
  expect(host.querySelector('#status-focus-title')?.textContent).toBe('School');
  expect(host.querySelector('.lv-checklist h3')?.textContent).toBe('Get back on pace');
  click(host.querySelector('[aria-label="Close life area"]')!);
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Current priority"]')!.value).toBe(fresh.id);
  act(() => root.unmount()); root = createRoot(host); act(() => root.render(<StatusLifeVitalsPage />));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Current priority"]')!.value).toBe(fresh.id);
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  setPriority(behind.id);
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Current priority"]')!.value).toBe(fresh.id);
  failure.mockRestore();
  setPriority('');
  expect(JSON.parse(localStorage.getItem(key)!).some((a: StatusVital) => a.priority)).toBe(false);
});

it('creates two-tier plans, enforces order and preserves check-in drafts across immediate checklist saves', () => {
  const key = statusVitalsKey(false);
  localStorage.setItem(key, JSON.stringify([saveCheckIn(area(), { status: 'behind', reason: '', next: '' })]));
  act(() => root.render(<StatusLifeVitalsPage />));
  click(host.querySelector('.lv-region')!);
  click(button('New check-in'));
  type(host.querySelector('.lv-status-form textarea')!, 'Draft reason stays');
  expect(host.querySelector('.lv-checklist')).toBeNull();
  click(host.querySelector('input[value=behind]')!);
  const add = (label: string) => {
    type(host.querySelector('.lv-plan-editor input')!, label);
    click(button('Save item'));
  };
  click(button('+ Add task')); add('Catch up lectures');
  click(button('+ Subtask')); add('Read notes');
  click(button('+ Subtask')); add('Practice questions');
  click(button('+ Add task')); add('Submit homework');
  const select = host.querySelector<HTMLSelectElement>('.lv-plan-order select')!;
  act(() => { select.value = 'sequential'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  const check = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="Complete ${label}"]`)!;
  expect(check('Practice questions').disabled).toBe(true);
  expect(check('Submit homework').disabled).toBe(true);
  click(check('Read notes')); click(check('Practice questions'));
  expect(check('Catch up lectures').checked).toBe(true);
  expect(check('Submit homework').disabled).toBe(false);
  click(check('Submit homework'));
  expect(host.querySelector<HTMLTextAreaElement>('.lv-status-form textarea')!.value).toBe('Draft reason stays');
  expect(JSON.parse(localStorage.getItem(key)!)[0].entries[0].status).toBe('behind');
  click(host.querySelector('input[value="on-pace"]')!); click(button('+ Add task')); add('Weekly review');
  click(check('Weekly review')); click(button('Reset checks')); click(button('Confirm'));
  expect(check('Weekly review').checked).toBe(false);
  act(() => root.unmount()); root = createRoot(host);
  act(() => root.render(<StatusLifeVitalsPage />)); click(host.querySelector('.lv-region')!);
  expect(host.querySelector('.lv-checklist h3')?.textContent).toBe('Get back on pace');
  click(button('New check-in'));
  expect(host.querySelector('.lv-checklist')).toBeNull();
  click(host.querySelector('input[value=behind]')!);
  expect(check('Submit homework').checked).toBe(true);
  click(host.querySelector('input[value="on-pace"]')!); expect(check('Weekly review').checked).toBe(false);
  click(host.querySelector('input[value=ahead]')!); expect(host.querySelector('.lv-checklist')).toBeNull();
});

it('preserves checklist edits on storage failure and requires confirmation before deleting a task with subtasks', () => {
  const key = statusVitalsKey(false);
  localStorage.setItem(key, JSON.stringify([{ ...area(), plans: { catchUp: { sequential: false, tasks: [] }, maintenance: { sequential: false, tasks: [{ id: 't', title: 'Review', done: false, subtasks: [{ id: 's', title: 'Read', done: false }] }] } } }]));
  act(() => root.render(<StatusLifeVitalsPage />)); click(host.querySelector('.lv-region')!);
  click(host.querySelector('input[value="on-pace"]')!);
  click(host.querySelector('[aria-label="Edit Read"]')!);
  type(host.querySelector('.lv-plan-editor input')!, 'Read chapter');
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  click(button('Save item'));
  expect(host.querySelector<HTMLInputElement>('.lv-plan-editor input')!.value).toBe('Read chapter');
  expect(host.textContent).toContain('Could not save checklist');
  failure.mockRestore(); click(button('Save item'));
  click(host.querySelector('[aria-label="Delete Review"]')!);
  expect(host.textContent).toContain('Delete this task and its subtasks?');
  expect(JSON.parse(localStorage.getItem(key)!)[0].plans.maintenance.tasks).toHaveLength(1);
  click(button('Confirm'));
  expect(JSON.parse(localStorage.getItem(key)!)[0].plans.maintenance.tasks).toEqual([]);
});
