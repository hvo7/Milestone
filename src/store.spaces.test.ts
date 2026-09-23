import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_SPACES, QUEST_STORE_KEY, useQuestStore } from './store';
import { useVynuesStore } from './vynuesStore';
import { search } from './lib/search';

const state = () => useQuestStore.getState();
beforeEach(() => {
  useQuestStore.setState({ spaces: DEFAULT_SPACES, questlines: [], systems: [], routines: [] });
  useVynuesStore.setState({ projects: [] });
});

it('creates unique tabs and removes/restores them without changing their contents', () => {
  const id = state().addSpace('  Coaching  ')!;
  expect(state().addSpace('coaching')).toBeNull();
  expect(state().addSpace(' ')).toBeNull();
  state().addQuestline('Win the season', '', '', 'amber', id);
  const ql = state().questlines[0];
  state().addQuest(ql.id, 'First match', '', null, null);
  const sys = state().addSystem('Practice', { spaceId: id });
  state().addSystemAction(sys, 'Warm up', 'daily');
  useVynuesStore.getState().addProject('Training camp', '', 'amber', id);
  const before = { questlines: state().questlines, systems: state().systems, routines: state().routines };
  state().updateSpace(id, { archived: true });
  expect(state()).toMatchObject(before);
  expect(state().spaces?.find(s => s.id === id)?.archived).toBe(true);
  state().updateSpace(id, { name: 'Basketball', archived: false });
  expect(state().spaces?.find(s => s.id === id)).toEqual({ id, name: 'Basketball', archived: false });
  expect(useVynuesStore.getState().projects[0].spaceId).toBe(id);
});

it('moves systems and questlines, preserving their nested data and clearing assignments', () => {
  const id = state().addSpace('Company')!;
  state().addQuestline('Launch', '', '', 'amber');
  const ql = state().questlines[0];
  state().updateQuestline(ql.id, { spaceId: id });
  expect(state().questlines[0].spaceId).toBe(id);
  const sys = state().addSystem('Ship');
  state().updateSystem(sys, { spaceId: id });
  expect(state().systems[0].spaceId).toBe(id);
  state().updateSystem(sys, { spaceId: undefined });
  expect(state().systems[0].spaceId).toBeUndefined();
});

it('does not combine identically named habits from different spaces', () => {
  const a = state().addSystem('Work', { spaceId: 'vynues' });
  const b = state().addSystem('Coaching', { spaceId: 'coaching' });
  state().addSystemAction(a, 'Review schedule', 'daily');
  state().addSystemAction(b, 'Review schedule', 'daily');
  expect(state().routines).toHaveLength(2);
  state().toggleRoutine(state().routines[0].id);
  expect(state().routines[1].completed).toBe(false);
});

it('persists spaces and assignments, and supports saves made before spaces existed', async () => {
  const id = state().addSpace('Coaching')!;
  state().addSystem('Practice', { spaceId: id });
  await useQuestStore.persist.rehydrate();
  expect(state().spaces?.find(s => s.id === id)?.name).toBe('Coaching');
  expect(state().systems[0].spaceId).toBe(id);
  localStorage.setItem(QUEST_STORE_KEY, JSON.stringify({ state: { questlines: [], routines: [], systems: [] }, version: 0 }));
  useQuestStore.setState({ spaces: DEFAULT_SPACES });
  // Restore the legacy payload after the state write persists.
  localStorage.setItem(QUEST_STORE_KEY, JSON.stringify({ state: { questlines: [], routines: [], systems: [] }, version: 0 }));
  await useQuestStore.persist.rehydrate();
  expect(state().spaces).toEqual(DEFAULT_SPACES);
  useVynuesStore.getState().addProject('Legacy default', '', 'amber');
  expect(useVynuesStore.getState().projects[0].spaceId).toBe('vynues');
});

it('search opens a project in its own space and falls back to All for removed tabs', () => {
  const id = state().addSpace('Coaching')!;
  useVynuesStore.getState().addProject('Training camp', '', 'amber', id);
  const results = () => search({ ...state(), projects: useVynuesStore.getState().projects }, 'Training camp');
  expect(results()[0]).toMatchObject({ context: 'Coaching', path: `/spaces/${id}?section=projects` });
  state().updateSpace(id, { archived: true });
  expect(results()[0].path).toBe('/all');
});
