import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AreaEditor, AreaFocus } from './SimpleLifeVitalsPage';
import { newVital, simplePace, type SimpleVital } from '../lib/simpleVitals';

vi.mock('../components/NavBar', () => ({ default: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = (element: Element) => act(() => (element as HTMLElement).click());
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
const vital = (): SimpleVital => ({ ...newVital(), name: 'Gym' });
const bounds = { left: 0, top: 0, width: 100, height: 100 };

it('checks in using two boxes, updates statuses and saves only on request', () => {
  const save = vi.fn<(area: SimpleVital) => boolean>(() => true); const close = vi.fn();
  act(() => root.render(<AreaFocus area={vital()} origin={bounds} onSave={save} onClose={close} onEdit={() => {}} />));
  const checks = host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
  expect(checks).toHaveLength(2);
  expect(checks[1].disabled).toBe(true);
  click(checks[0]);
  expect(host.querySelector('.lv-badge')?.textContent).toContain('On pace');
  expect(save).not.toHaveBeenCalled();
  click(checks[1]);
  expect(host.querySelector('.lv-badge')?.textContent).toContain('Ahead');
  click(button('Save check-in'));
  expect(simplePace(save.mock.calls[0][0])).toBe('ahead');
  expect(close).toHaveBeenCalledOnce();
});

it('clears extra progress when a basic is unchecked and permits a fully unchecked behind check-in', () => {
  const save = vi.fn<(area: SimpleVital) => boolean>(() => true);
  const area = vital(); area.checks[0].done = true; area.extra = true; area.checkedAt = new Date().toISOString();
  act(() => root.render(<AreaFocus area={area} origin={bounds} onSave={save} onClose={() => {}} onEdit={() => {}} />));
  click(host.querySelector('input')!);
  const checks = host.querySelectorAll<HTMLInputElement>('input');
  expect(checks[1].checked).toBe(false);
  expect(checks[1].disabled).toBe(true);
  click(button('Save check-in'));
  expect(simplePace(save.mock.calls[0][0])).toBe('behind');
});

it('leaves unsaved changes out of the saved area on close and keeps failed saves open', () => {
  const save = vi.fn<(area: SimpleVital) => boolean>(() => false); const close = vi.fn(); const area = vital();
  act(() => root.render(<AreaFocus area={area} origin={bounds} onSave={save} onClose={close} onEdit={() => {}} />));
  click(host.querySelector('input')!);
  expect(area.checks[0].done).toBe(false);
  click(button('Save check-in'));
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Couldn’t save');
  click(host.querySelector('[aria-label="Close life area"]')!);
  expect(close).toHaveBeenCalledOnce();
});

it('setup has just two initial text inputs, caps basics at three, and no numeric settings', () => {
  act(() => root.render(<AreaEditor area={vital()} isNew onSave={() => true} onClose={() => {}} onArchive={() => true} />));
  expect(host.querySelectorAll('input')).toHaveLength(2);
  expect(host.querySelectorAll('select, textarea, input[type=number]')).toHaveLength(0);
  click(button('Add a check')); click(button('Add a check'));
  expect(host.querySelectorAll('input')).toHaveLength(4);
  expect(button('Add a check')).toBeUndefined();
  click(host.querySelector('[aria-label="Remove item 3"]')!);
  expect(button('Add a check')).toBeDefined();
});
