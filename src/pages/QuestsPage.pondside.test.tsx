/** Pondside batch 2: the two-pane Quests tab. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QuestsPage from './QuestsPage';
import { dateKey, logicalDayStart, useQuestStore } from '../store';
import { useUIStore } from '../uiStore';
import { quietSignal, shiftDay, type Movement } from '../lib/momentum';

vi.mock('../components/NavBar', () => ({ default: () => null }));
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useQuestStore.setState({ routines: [], questlines: [], systems: [], completionLog: {}, taskHistory: {} });
  useUIStore.setState({ editMode: false, showPageArt: undefined });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const today = () => dateKey(logicalDayStart());
const render = (path = '/quests') => act(() => root.render(<MemoryRouter initialEntries={[path]}><QuestsPage /></MemoryRouter>));
const click = (el: Element) => act(() => (el as HTMLElement).click());
const cards = () => [...host.querySelectorAll<HTMLButtonElement>('.cold-card')];
const names = () => cards().map(c => c.querySelector('.cold-card-name')!.textContent);
const card = (name: string) => cards().find(c => c.querySelector('.cold-card-name')!.textContent === name)!;
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const movement = (daysSince: number | null): Movement => ({ lastDay: null, daysSince, activeDays: 0, moves: 0, days: 30 });

/** Three questlines: one quiet for 30 days, one that moved 3 days ago, one that moves today. */
function seed() {
  const qs = useQuestStore.getState();
  for (const title of ['Warm', 'Cold', 'Fresh']) qs.addQuestline(title, '', '', 'sapphire');
  const ids: Record<string, { ql: string; quest: string; action: string }> = {};
  for (const ql of useQuestStore.getState().questlines) {
    qs.addQuest(ql.id, `${ql.title} first`, '', null, null, null, 'steps');
    qs.addQuest(ql.id, `${ql.title} second`, '', null, null, null, 'steps');
    const [first, second] = useQuestStore.getState().questlines.find(q => q.id === ql.id)!.quests;
    qs.addAction(ql.id, first.id, `${ql.title} step`);
    qs.addAction(ql.id, first.id, `${ql.title} other step`);
    qs.addAction(ql.id, second.id, `${ql.title} later step`);
    const action = useQuestStore.getState().questlines.find(q => q.id === ql.id)!.quests[0].actions[0].id;
    ids[ql.title] = { ql: ql.id, quest: first.id, action };
  }
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
  useQuestStore.setState(s => ({
    // Fresh is new today; the other two are two months old.
    questlines: s.questlines.map(ql => ({ ...ql, createdAt: ql.title === 'Fresh' ? new Date().toISOString() : old })),
    taskHistory: {
      [ids.Cold.action]: [shiftDay(today(), -30)],
      [ids.Warm.action]: [shiftDay(today(), -3)],
    },
  }));
  return ids;
}

it('words the quiet-goal reading factually and tones it gold, leaf or plain', () => {
  expect(quietSignal({ state: 'cold', movement: movement(19) })).toEqual({ text: 'Quiet 19 days', tone: 'quiet' });
  expect(quietSignal({ state: 'cold', movement: movement(null) })).toEqual({ text: 'Quiet so far', tone: 'quiet' });
  expect(quietSignal({ state: 'moving', movement: movement(0) })).toEqual({ text: 'Moved today', tone: 'today' });
  expect(quietSignal({ state: 'moving', movement: movement(1) })).toEqual({ text: 'Moved yesterday', tone: 'plain' });
  expect(quietSignal({ state: 'slowing', movement: movement(9) })).toEqual({ text: 'Moved 9 days ago', tone: 'plain' });
  expect(quietSignal({ state: 'idle', movement: movement(null) })).toEqual({ text: 'Not started', tone: 'plain' });
  expect(quietSignal({ state: 'done', movement: movement(0) })).toEqual({ text: 'Complete', tone: 'plain' });
});

it('lists questlines coldest first, opens the coldest by default and leaves the saved order alone', () => {
  seed();
  const saved = useQuestStore.getState().questlines.map(q => q.title);
  render();
  expect(host.querySelector('h1')!.textContent).toBe('Quests');
  expect(names()).toEqual(['Cold', 'Warm', 'Fresh', 'General']);
  expect(card('Cold').getAttribute('aria-current')).toBe('true');
  expect(card('Cold').querySelector('.cold-card-signal')!.textContent).toBe('Quiet 30 days');
  expect(card('Cold').querySelector('.cold-card-signal')!.getAttribute('data-tone')).toBe('quiet');
  expect(card('Warm').querySelector('.cold-card-signal')!.textContent).toBe('Moved 3 days ago');
  expect(card('Cold').querySelector('.cold-card-count')!.textContent).toBe('0 / 2');
  expect(host.querySelector('.questline-panel-title h2')!.textContent).toBe('Cold');
  expect(useQuestStore.getState().questlines.map(q => q.title)).toEqual(saved);
});

it('shows the selected questline with momentum chips and progress, and re-sorts when a step is checked', () => {
  seed();
  render();
  click(card('Cold'));
  expect(host.querySelector('.quests-shell')!.hasAttribute('data-chosen')).toBe(true);
  expect(host.querySelector('.questline-panel-progress span')!.textContent).toBe('0 of 2');
  expect([...host.querySelectorAll('.momentum-chip')].map(c => c.textContent)).toEqual(['Quiet 30 days', '0 tasks in 30 days']);
  // In a flexible questline a quest opens when its row is clicked.
  click(host.querySelector('.quest-row .quest-mobile-row')!);
  click(host.querySelector('input[aria-label="Cold step"]')!);
  // It moved today: leaf tone, and no longer the coldest.
  expect(names()).toEqual(['Warm', 'Cold', 'Fresh', 'General']);
  expect(card('Cold').querySelector('.cold-card-signal')!.textContent).toBe('Moved today');
  expect(card('Cold').querySelector('.cold-card-signal')!.getAttribute('data-tone')).toBe('today');
  expect(host.querySelector('.momentum-chip')!.getAttribute('data-tone')).toBe('today');
  expect(host.querySelector('.momentum-chips')!.textContent).toContain('1 task in 30 days');
  // Still selected: the detail did not jump to another questline.
  expect(host.querySelector('.questline-panel-title h2')!.textContent).toBe('Cold');
});

it('marks done, current and locked quests in a sequential questline and shows what is on Today', () => {
  const ids = seed();
  act(() => useQuestStore.getState().updateQuestline(ids.Fresh.ql, { sequential: true }));
  render(`/quests?questline=${ids.Fresh.ql}`);
  const states = () => [...host.querySelectorAll('.quest-rows > .quest-row')].map(r => r.getAttribute('data-state'));
  expect([...host.querySelectorAll('.momentum-chip')].map(c => c.textContent)).toContain('Sequential');
  expect(states()).toEqual(['current', 'locked']);
  expect(host.querySelector('.quest-row[data-state="locked"] .quest-lock')!.getAttribute('aria-label')).toBe('Locked');
  expect(host.querySelector('.quest-row[data-state="locked"] .rune-check')).toBeNull();
  // The current quest's steps are open; pin one to Today.
  const pin = host.querySelector<HTMLButtonElement>('.quest-row[data-state="current"] .quest-step .pin-button')!;
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  click(pin);
  const pinned = host.querySelector<HTMLButtonElement>('.quest-row[data-state="current"] .quest-step .pin-button')!;
  expect(pinned.getAttribute('aria-pressed')).toBe('true');
  expect(pinned.textContent).toBe('On Today');
  // Finish the first quest: it reads done, and the next one unlocks as current.
  click(host.querySelector('input[aria-label="Fresh step"]')!);
  click(host.querySelector('input[aria-label="Fresh other step"]')!);
  expect(states().sort()).toEqual(['current', 'done']);
  expect(host.querySelector('.questline-panel-progress span')!.textContent).toBe('1 of 2');
});

it('opens General and returns to the list with Back, keeps edit mode, and gates New quest on a questline', () => {
  seed();
  act(() => { useQuestStore.getState().addRoutine('Renew passport', '', null); });
  render();
  expect(card('General').querySelector('.cold-card-count')!.textContent).toBe('1');
  click(card('General'));
  expect(host.querySelector('.quests-detail')!.getAttribute('aria-label')).toBe('General');
  expect(host.textContent).toContain('Renew passport');
  expect(button('New quest').disabled).toBe(true);
  click(button('Back'));
  expect(host.querySelector('.quests-shell')!.hasAttribute('data-chosen')).toBe(false);
  expect(button('New quest').disabled).toBe(false);
  click(button('Edit'));
  expect(useUIStore.getState().editMode).toBe(true);
  expect(host.querySelector('.quest-row-edit')).toBeTruthy();
  click(button('Done'));
  expect(useUIStore.getState().editMode).toBe(false);
});
