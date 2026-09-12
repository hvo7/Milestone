import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQuestComplete, isQuestUnlocked, isArchivedRoutine, useQuestStore, QUEST_STORE_KEY } from './store';
import { clearHistory, redo, startHistory, undo } from './lib/history';
import type { Quest, Routine } from './types';

const st = () => useQuestStore.getState();
const getQuest = () => st().questlines[0].quests[0];
const now = () => new Date(2026, 8, 11, 12).toISOString();
const quest = (over: Partial<Quest> = {}): Quest => ({ id: 'q', title: 'First 5K', description: 'Finish the event', order: 1, actions: [{ id: 'a', title: 'Register', completed: false }], ...over });
const routine = (over: Partial<Routine> = {}): Routine => ({ id: 'r', title: 'Daily mile', recurring: 'daily', completed: false, trackedToday: true, lastResetAt: now(), ...over });
function seed(q = quest()) {
  useQuestStore.setState({ questlines: [{ id: 'goal', title: 'Marathon', description: '', icon: '', color: 'amber', sequential: true, quests: [q, quest({ id: 'next', order: 2, actions: [] })] }],
    routines: [routine({ systemId: 'sys', anchor: true })], systems: [{ id: 'sys', title: 'Running', questlineId: 'goal' }],
    completionLog: {}, taskHistory: {}, todoOrder: {}, anchorSystemRetired: true });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 11, 12)); seed(); startHistory(); clearHistory(); });
afterEach(() => { clearHistory(); vi.useRealTimers(); });

describe('workspace preservation', () => {
  it('keeps old completed and hidden tasks, nested steps and history on rollover and rehydration', async () => {
    const saved = routine({ recurring: null, completed: true, completedAt: '2024-01-01T12:00:00.000Z', hidden: true,
      subtasks: [{ id: 's', title: 'Old step', completed: true, children: [{ id: 'nested', title: 'Nested', completed: true }] }] });
    useQuestStore.setState({ routines: [saved], taskHistory: { r: ['2024-01-01'], a: ['2024-01-01'] }, completionLog: { '2024-01-01': 2 } });
    const goals = structuredClone(st().questlines);
    st().checkAndResetRecurring();
    expect(st().routines).toEqual([saved]);
    expect(st().questlines).toEqual(goals);
    expect(st().taskHistory).toEqual({ r: ['2024-01-01'], a: ['2024-01-01'] });
    expect(st().completionLog).toEqual({ '2024-01-01': 2 });
    const savedJson = localStorage.getItem(QUEST_STORE_KEY);
    expect(savedJson).toBeTruthy();
    await useQuestStore.persist.rehydrate();
    expect(st().routines).toEqual([saved]);
    expect(st().questlines).toEqual(goals);
    expect(isArchivedRoutine(saved)).toBe(true);
  });
  it('uses one habit ID for system and spotlight completion, including undo', () => {
    st().toggleRoutine('r');
    expect(st().routines).toHaveLength(1);
    expect(st().routines[0]).toMatchObject({ id: 'r', anchor: true, systemId: 'sys', completed: true });
    expect(st().taskHistory.r).toEqual(['2026-09-11']);
    expect(undo()).toBe(true);
    expect(st().routines[0].completed).toBe(false);
    expect(st().taskHistory.r).toBeUndefined();
    expect(redo()).toBe(true);
    expect(st().routines[0].completed).toBe(true);
  });
  it('does not archive a calendar-only recurring task', () => {
    expect(isArchivedRoutine(routine({ recurring: null, monthlyRule: { nth: 1, kind: 'mon' }, completed: true, completedAt: '2024-01-01T12:00:00.000Z' }))).toBe(false);
  });
});

describe('milestone achievement without rewriting existing quests', () => {
  it('keeps existing checklist behavior and historical fields', () => {
    st().toggleAction('goal', 'q', 'a');
    expect(isQuestComplete(getQuest())).toBe(true);
    expect(getQuest().completionMode).toBeUndefined();
    expect(st().taskHistory.a).toEqual(['2026-09-11']);
  });
  it('defaults new finite quests to manual achievement and repeating quests to steps', () => {
    st().addQuest('goal', 'New milestone', '', null, null);
    st().addQuest('goal', 'Weekly practice', '', 'weekly', null);
    expect(st().questlines[0].quests.slice(-2).map(q => q.completionMode)).toEqual(['manual', 'steps']);
  });
  it('preparation does not unlock the next quest; achievement does and undo leaves preparation intact', () => {
    seed(quest({ completionMode: 'manual' }));
    st().toggleAction('goal', 'q', 'a');
    expect(isQuestComplete(getQuest())).toBe(false);
    expect(isQuestUnlocked(st().questlines[0], st().questlines[0].quests[1])).toBe(false);
    st().setQuestComplete('goal', 'q', true);
    expect(isQuestComplete(getQuest())).toBe(true);
    expect(isQuestUnlocked(st().questlines[0], st().questlines[0].quests[1])).toBe(true);
    expect(st().completionLog['2026-09-11']).toBe(2);
    st().setQuestComplete('goal', 'q', false);
    expect(getQuest().actions[0].completed).toBe(true);
    expect(st().completionLog['2026-09-11']).toBe(1);
    expect(st().taskHistory.a).toEqual(['2026-09-11']);
    expect(st().taskHistory.q).toBeUndefined();
  });
  it('opting a completed legacy quest into manual mode retains completion without inventing credit', () => {
    const stamp = '2026-08-10T12:00:00.000Z';
    seed(quest({ actions: [{ id: 'a', title: 'Register', completed: true, completedAt: stamp }] }));
    useQuestStore.setState({ completionLog: { '2026-08-10': 1 }, taskHistory: { a: ['2026-08-10'] } });
    st().updateQuest('goal', 'q', { completionMode: 'manual' });
    expect(isQuestComplete(getQuest())).toBe(true);
    st().setQuestComplete('goal', 'q', false);
    expect(st().completionLog).toEqual({ '2026-08-10': 1 });
    expect(getQuest().actions[0].completedAt).toBe(stamp);
  });
});
