/**
 * Pondside batch 1: the approved feedback moments and the page-art preference.
 * Journeys through the agenda's own controls live in Today.test.tsx.
 */
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
import { useUndoStore, UNDO_WINDOW_MS } from '../lib/undo';
import { claimDayClosed, isDayClosed } from '../lib/dayClosed';
import { motionMs } from '../lib/motion';

vi.mock('../components/NavBar', () => ({ default: () => null }));
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useQuestStore.setState({ routines: [], questlines: [], systems: [], todoOrder: {}, completionLog: {}, taskHistory: {} });
  useVynuesStore.setState({ projects: [] });
  useUIStore.setState({ hiddenAgendaRows: undefined, dayClosedOn: undefined, showPageArt: undefined });
  useUndoStore.getState().dismiss();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const today = () => dateKey(logicalDayStart());
const daily = (id: string, more: Partial<Routine> = {}): Routine =>
  ({ id, title: id, recurring: 'daily', trackedToday: false, completed: false, ...more });
const render = () => act(() => root.render(<MemoryRouter><Today /><UndoToast /></MemoryRouter>));
const click = (element: Element) => act(() => (element as HTMLElement).click());
const check = (name: string) => host.querySelector<HTMLInputElement>(`.inline-check-target input[aria-label="${name}"]`)!;
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const progress = () => host.querySelector<HTMLElement>('.pond-progress')!;
/** Stand a real `matchMedia` up, answering the reduced-motion query as given. */
const stubMotion = (reduced: boolean) => vi.stubGlobal('matchMedia', (query: string) =>
  ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));

function seedQuestline(sequential: boolean, mode?: 'manual' | 'steps') {
  const qs = useQuestStore.getState();
  qs.addQuestline('Data Science', '', '', 'sapphire');
  const qlId = useQuestStore.getState().questlines[0].id;
  qs.addQuest(qlId, 'Get started', '', null, null, null, mode);
  qs.addQuest(qlId, 'Practice deliberately', '', null, null);
  if (sequential) qs.updateQuestline(qlId, { sequential: true });
  const [first, second] = useQuestStore.getState().questlines[0].quests;
  qs.addAction(qlId, first.id, 'Install tools');
  qs.addAction(qlId, second.id, 'First kata');
  qs.toggleQuestTracked(qlId, first.id);
  return { qlId, first: first.id };
}

it('shows the day as closed at 100% and plays the moment once per logical day', () => {
  useQuestStore.setState({ routines: [daily('Read'), daily('Walk', { anchor: true })] });
  render();
  expect(progress().textContent).toBe('0 of 2');
  expect(progress().hasAttribute('data-closed')).toBe(false);
  click(check('Read'));
  click(check('Walk'));
  expect(progress().textContent).toBe('Today’s list is clear');
  expect(progress().querySelector('.progress-ring[data-done]')).toBeTruthy();
  // The bar stays for assistive tech, at its full value.
  expect(host.querySelector('progress')!.value).toBe(2);
  expect(progress().getAttribute('data-play')).toBe('true');
  expect(useUIStore.getState().dayClosedOn).toBe(today());
  // Today's heatmap cell fills.
  expect(host.querySelector('.pond-panel .heat-cell[data-today][data-closed]')).toBeTruthy();

  // Reopen and finish again the same day: closed is shown, the moment is not replayed.
  click(check('Walk'));
  expect(progress().textContent).toBe('1 of 2');
  expect(progress().hasAttribute('data-play')).toBe(false);
  click(check('Walk'));
  expect(progress().hasAttribute('data-closed')).toBe(true);
  expect(progress().hasAttribute('data-play')).toBe(false);
});

it('keeps the once-per-day marker across a reload and releases it on the next logical day', async () => {
  expect(isDayClosed(0, 0)).toBe(false);
  expect(isDayClosed(3, 3, true)).toBe(false);
  expect(isDayClosed(3, 3)).toBe(true);
  expect(claimDayClosed('2026-11-23')).toBe(true);
  expect(claimDayClosed('2026-11-23')).toBe(false);
  const saved = localStorage.getItem(UI_STORE_KEY)!;
  useUIStore.setState({ dayClosedOn: undefined });
  localStorage.setItem(UI_STORE_KEY, saved);
  await useUIStore.persist.rehydrate();
  expect(claimDayClosed('2026-11-23')).toBe(false);
  expect(claimDayClosed('2026-11-24')).toBe(true);
});

it('never closes the Tomorrow preview and leaves skipped work out of the count', () => {
  useQuestStore.setState({ routines: [
    daily('Read', { completed: true, completedAt: new Date().toISOString() }),
    daily('Rest', { skippedOn: today() }),
  ] });
  render();
  expect(progress().hasAttribute('data-closed')).toBe(true);
  click(host.querySelector('[aria-label="List options"]')!);
  click(button('Tomorrow'));
  expect(progress().hasAttribute('data-closed')).toBe(false);
});

it('names the finished quest, shows its questline art and what it unlocked, and Undo restores everything', () => {
  const { first } = seedQuestline(true);
  const before = useQuestStore.getState();
  render();
  click(check('Get started'));
  const toast = host.querySelector('[role="status"]')!;
  expect(toast.getAttribute('data-toast-kind')).toBe('quest-complete');
  expect(toast.querySelector('.toast-label')!.textContent).toBe('Quest complete · Get started');
  expect(toast.querySelector('.toast-detail')!.textContent).toBe('Practice deliberately unlocked');
  expect(toast.querySelector<HTMLImageElement>('img.toast-art')!.src).toMatch(/^data:image\/svg\+xml/);
  expect(useQuestStore.getState().completionLog[today()]).toBe(1);
  expect(UNDO_WINDOW_MS).toBe(12_000);

  click(button('Undo'));
  const after = useQuestStore.getState();
  expect(after.questlines).toBe(before.questlines);
  expect(after.completionLog).toBe(before.completionLog);
  expect(after.taskHistory).toBe(before.taskHistory);
  expect(after.questlines[0].quests.find(q => q.id === first)!.actions[0].completed).toBe(false);
  expect(useUndoStore.getState().entry).toBeNull();
});

it('says nothing was unlocked in a non-sequential questline, and stays quiet for a step that does not finish the quest', () => {
  // A checklist quest: finishing its last step is what finishes it.
  const { qlId, first } = seedQuestline(false, 'steps');
  act(() => useQuestStore.getState().addAction(qlId, first, 'Read the docs'));
  render();
  click([...host.querySelectorAll<HTMLButtonElement>('.inline-title')].find(b => b.textContent === 'Get started')!);
  click(host.querySelector('input[aria-label="Install tools"]')!);
  expect(host.querySelector('[role="status"]')).toBeNull();
  click(host.querySelector('input[aria-label="Read the docs"]')!);
  const toast = host.querySelector('[role="status"]')!;
  expect(toast.querySelector('.toast-label')!.textContent).toBe('Quest complete · Get started');
  expect(toast.querySelector('.toast-detail')).toBeNull();
});

it('shows the banner with its date by default and drops it, with no placeholder, when page art is off', async () => {
  render();
  const banner = host.querySelector('.page-banner')!;
  expect(banner.querySelector('img')!.getAttribute('alt')).toBe('');
  expect(banner.querySelector('time')!.dateTime).toBe(today());
  act(() => useUIStore.getState().setShowPageArt(false));
  expect(host.querySelector('.page-banner')).toBeNull();
  expect(host.querySelector('main')!.firstElementChild!.className).toBe('agenda-layout');
  // Persisted in the existing UI store, as an optional key.
  expect(JSON.parse(localStorage.getItem(UI_STORE_KEY)!).state.showPageArt).toBe(false);
  act(() => useUIStore.getState().setShowPageArt(true));
  expect(host.querySelector('.page-banner')).toBeTruthy();
  // A save from a build without the key reads as "on".
  const legacy = JSON.parse(localStorage.getItem(UI_STORE_KEY)!);
  delete legacy.state.showPageArt;
  act(() => useUIStore.setState({ showPageArt: undefined }));
  localStorage.setItem(UI_STORE_KEY, JSON.stringify(legacy));
  await act(async () => { await useUIStore.persist.rehydrate(); });
  expect(host.querySelector('.page-banner')).toBeTruthy();
});

it('fills the ring before a task leaves the list, and completes instantly under reduced motion', () => {
  useQuestStore.setState({ routines: [daily('Read'), daily('Write')] });

  stubMotion(false);
  vi.useFakeTimers();
  expect(motionMs('check')).toBe(180);
  expect(motionMs('expand')).toBe(140);
  render();
  click(check('Read'));
  // The ring shows filled at once; the task itself completes when the fill ends.
  expect(check('Read').checked).toBe(true);
  expect(useQuestStore.getState().routines[0].completed).toBe(false);
  act(() => { vi.advanceTimersByTime(180); });
  expect(useQuestStore.getState().routines[0].completed).toBe(true);

  stubMotion(true);
  expect(motionMs('check')).toBe(0);
  expect(motionMs('expand')).toBe(0);
  click(check('Write'));
  expect(useQuestStore.getState().routines[1].completed).toBe(true);
});
