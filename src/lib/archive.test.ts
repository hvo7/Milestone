import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Questline, Routine, System } from '../types';
import { routineIsArchived } from './archive';
import { dueSummary } from './today';
import { useQuestStore } from '../store';
import ScheduleDueField from '../components/ScheduleDueField';

const ql: Questline = { id: 'goal', title: 'Goal', description: '', icon: '', color: 'blue', quests: [{ id: 'quest', title: 'Quest', description: '', order: 1, trackedToday: true, actions: [{ id: 'step', title: 'Step', completed: false, recurring: 'daily' }] }] };
const routine: Routine = { id: 'habit', title: 'Habit', recurring: 'daily', completed: false, trackedToday: false, systemIds: ['system'] };
const system: System = { id: 'system', title: 'System', questlineIds: ['goal'] };
const initial = useQuestStore.getState();
afterEach(() => useQuestStore.setState(initial));

describe('archive focus and restoration', () => {
  it('pauses system-only habits while preserving shared active habits', () => {
    expect(routineIsArchived(routine, [ql], [{ ...system, hidden: true }])).toBe(true);
    expect(routineIsArchived({ ...routine, systemIds: ['system', 'other'] }, [ql], [{ ...system, hidden: true }, { id: 'other', title: 'Other' }])).toBe(false);
    expect(routineIsArchived(routine, [ql], [system])).toBe(false);
  });
  it('pauses linked routines for archived quests and questlines', () => {
    const linked = { ...routine, questlineId: ql.id, questId: 'quest' };
    expect(routineIsArchived(linked, [{ ...ql, hidden: true }], [system])).toBe(true);
    expect(routineIsArchived(linked, [{ ...ql, quests: [{ ...ql.quests[0], hidden: true }] }], [system])).toBe(true);
  });
  it('keeps archived tasks out of reminder counts', () => {
    expect(dueSummary({ questlines: [{ ...ql, hidden: true }], routines: [routine], systems: [{ ...system, hidden: true }] }, { projects: [] }).total).toBe(0);
    expect(dueSummary({ questlines: [ql], routines: [routine], systems: [system] }, { projects: [] }).total).toBe(2);
  });
  it('archives and restores without losing contents or links, and persists flags', () => {
    useQuestStore.setState({ questlines: [ql], systems: [system], routines: [routine] });
    const actions = useQuestStore.getState();
    actions.updateSystem(system.id, { hidden: true });
    actions.toggleQuestHidden(ql.id, 'quest');
    actions.toggleQuestlineHidden(ql.id);
    const saved = JSON.parse(localStorage.getItem('milestone-v1')!).state;
    expect(saved.systems[0].hidden).toBe(true);
    expect(saved.questlines[0].quests[0].hidden).toBe(true);
    expect(saved.questlines[0].hidden).toBe(true);
    expect(saved.routines[0]).toEqual(routine);
    actions.updateSystem(system.id, { hidden: false });
    actions.toggleQuestHidden(ql.id, 'quest');
    actions.toggleQuestlineHidden(ql.id);
    expect(useQuestStore.getState().questlines[0].quests[0].actions).toEqual(ql.quests[0].actions);
    expect(useQuestStore.getState().systems[0].questlineIds).toEqual(['goal']);
    expect(routineIsArchived(routine, useQuestStore.getState().questlines, useQuestStore.getState().systems)).toBe(false);
  });
});

it('uses the same input styling for Once and Repeat without overwriting a one-off date', () => {
  const render = (recurring: 'daily' | null) => renderToStaticMarkup(createElement(ScheduleDueField, { schedule: { recurring }, value: '2026-10-01', onChange: () => {} }));
  const once = render(null), repeat = render('daily');
  expect(once).toContain('value="2026-10-01"');
  expect(once).toContain('aria-label="Due date"');
  expect(repeat).toContain('aria-label="Current due date"');
  expect(repeat).toContain('readOnly=""');
  expect(repeat).toContain('Next due:');
  expect(once).toContain('class="rune-input"');
  expect(repeat).toContain('class="rune-input"');
});
