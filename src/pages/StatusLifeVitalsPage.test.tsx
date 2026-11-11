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
