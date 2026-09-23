import { beforeEach, expect, it } from 'vitest';
import { useQuestStore } from './store';
import { clearHistory, startHistory, undo, redo } from './lib/history';
import { readQuestlineSelection } from './lib/questlineNavigation';

const state = () => useQuestStore.getState();
beforeEach(() => {
  useQuestStore.setState({ questlines: [], routines: [], systems: [] });
  for (const title of ['A', 'Hidden', 'B', 'C']) state().addQuestline(title, '', '', 'amber');
  state().toggleQuestlineHidden(state().questlines[1].id);
  const first = state().questlines[0];
  state().addQuest(first.id, 'Nested quest', '', null, null);
  startHistory(); clearHistory();
});

it('reorders the visible sidebar without moving hidden rows or changing nested content', () => {
  const before = state().questlines;
  state().reorderQuestlines([before[3].id, before[0].id, before[2].id]);
  expect(state().questlines).toEqual([before[3], before[1], before[0], before[2]]);
  expect(state().questlines[2]).toBe(before[0]);
  const params = new URLSearchParams({ questline: before[0].id });
  expect(readQuestlineSelection(params, state().questlines)).toEqual({ kind: 'questline', id: before[0].id });
});

it('ignores unknown and duplicate ids and supports undo, redo, and reload', async () => {
  const before = state().questlines;
  state().reorderQuestlines([before[3].id, 'missing', before[3].id, before[0].id]);
  const after = [before[3], before[1], before[2], before[0]];
  expect(state().questlines).toEqual(after);
  undo(); expect(state().questlines).toEqual(before);
  redo(); expect(state().questlines).toEqual(after);
  await useQuestStore.persist.rehydrate();
  expect(state().questlines).toEqual(after);
});
