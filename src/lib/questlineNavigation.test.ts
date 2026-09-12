import { describe, expect, it } from 'vitest';
import type { Questline, Routine, System } from '../types';
import { hasVisibleSystem, isUnlinkedSystem, questlineHref, readQuestlineSelection, routineServesQuestline, selectionParams, systemServesQuestline } from './questlineNavigation';

const goal: Questline = { id: 'goal/one & two', title: 'Marathon', description: '', icon: '', color: 'amber', quests: [{ id: '5k', title: '5K', description: '', order: 1, actions: [] }] };
const other: Questline = { ...goal, id: 'other', quests: [] };
const routine: Routine = { id: 'r', title: 'Daily mile', recurring: 'daily', completed: false, trackedToday: true };

describe('questline views over existing links', () => {
  it('includes direct, legacy, and quest-only links without changing stored records', () => {
    const systems: System[] = [
      { id: 'direct', title: 'Direct', questlineIds: [goal.id, other.id] },
      { id: 'legacy', title: 'Legacy', questlineId: goal.id },
      { id: 'quest', title: 'Quest only', questIds: ['5k'] },
      { id: 'general', title: 'General' },
    ];
    const before = JSON.stringify({ goal, systems });
    expect(systems.filter(s => systemServesQuestline(s, goal)).map(s => s.id)).toEqual(['direct', 'legacy', 'quest']);
    expect(systems.filter(s => systemServesQuestline(s, other)).map(s => s.id)).toEqual(['direct']);
    expect(systems.filter(isUnlinkedSystem).map(s => s.id)).toEqual(['general']);
    expect(JSON.stringify({ goal, systems })).toBe(before);
  });
  it('keeps hidden and unresolved links out of General without discarding them', () => {
    expect(isUnlinkedSystem({ id: 'x', title: 'X', questIds: ['missing'] })).toBe(false);
    expect(systemServesQuestline({ id: 'x', title: 'X', questIds: ['5k'] }, { ...goal, quests: [{ ...goal.quests[0], hidden: true }] })).toBe(true);
  });
  it('finds loose legacy habits and does not mistake a filter for membership', () => {
    expect(routineServesQuestline({ ...routine, questId: '5k' }, goal)).toBe(true);
    expect(hasVisibleSystem({ ...routine, systemId: 'sys' }, [{ id: 'sys', title: 'Practice' }])).toBe(true);
    expect(hasVisibleSystem({ ...routine, systemIds: ['missing', 'hidden'] }, [{ id: 'hidden', title: 'Hidden', hidden: true }])).toBe(false);
  });
  it('handles encoded IDs, deleted selections, empty saves and General explicitly', () => {
    expect(questlineHref('systems', goal.id)).toBe('/systems?questline=goal%2Fone+%26+two');
    const selection = { kind: 'questline' as const, id: goal.id };
    expect(readQuestlineSelection(selectionParams(selection), [goal])).toEqual(selection);
    expect(readQuestlineSelection(new URLSearchParams('questline=deleted'), [goal])).toEqual(selection);
    expect(readQuestlineSelection(new URLSearchParams(), [], true)).toEqual({ kind: 'all' });
    expect(readQuestlineSelection(new URLSearchParams(), [])).toEqual({ kind: 'general' });
    expect(readQuestlineSelection(new URLSearchParams('view=general'), [goal], true)).toEqual({ kind: 'general' });
  });
});
