/**
 * Systems in the store: the relationships, and the one-time seed.
 *
 * Two rules carry most of the weight here, and both are about not destroying
 * work when a grouping changes: deleting a system keeps its habits, and
 * deleting a goal keeps the systems that served it. The seed is gated so that
 * undoing it by hand actually sticks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useQuestStore, systemGoalIds, systemQuestIds, routineSystemIds } from './store';
import { systemRoutines } from './lib/systems';
import { ANCHOR_LABEL } from './lib/ui';
import type { Routine, Questline } from './types';

const now = () => new Date(2026, 7, 10, 12).toISOString();

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Habit', recurring: 'daily', completed: false, trackedToday: true,
  lastResetAt: now(), streak: 0, ...over,
});

const seed = (over: Partial<{ routines: Routine[]; systems: never[]; questlines: Questline[]; systemsSeeded: boolean }> = {}) =>
  useQuestStore.setState({
    questlines: [], routines: [], systems: [], completionLog: {}, taskHistory: {},
    systemsSeeded: undefined, ...over,
  } as never);

const st = () => useQuestStore.getState();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 10, 12)); seed(); });
afterEach(() => { vi.useRealTimers(); });

describe('system CRUD', () => {
  it('creates one and hands back its id', () => {
    const id = st().addSystem('Physical base');
    expect(id).toMatch(/^sys-/);
    expect(st().systems).toHaveLength(1);
    expect(st().systems[0].title).toBe('Physical base');
    expect(systemGoalIds(st().systems[0])).toEqual([]);   // a goal is optional
  });

  it('attaches and detaches a goal', () => {
    const id = st().addSystem('Base', { questlineIds: ['ql-health'] });
    expect(systemGoalIds(st().systems[0])).toEqual(['ql-health']);
    st().updateSystem(id, { questlineIds: [] });
    expect(systemGoalIds(st().systems[0])).toEqual([]);
  });

  it('renames without disturbing anything else', () => {
    const id = st().addSystem('Base', { questlineIds: ['ql-health'] });
    st().updateSystem(id, { title: 'Physical base' });
    expect(st().systems[0].title).toBe('Physical base');
    expect(systemGoalIds(st().systems[0])).toEqual(['ql-health']);
  });

  it('moves a habit in and out', () => {
    seed({ routines: [routine()] });
    const id = st().addSystem('Base');
    st().toggleRoutineSystem('r1', id);
    expect(routineSystemIds(st().routines[0])).toEqual([id]);
    st().toggleRoutineSystem('r1', id);
    expect(routineSystemIds(st().routines[0])).toEqual([]);
  });

  it('keeps the habits when the system is deleted', () => {
    seed({ routines: [routine(), routine({ id: 'r2', title: 'Other' })] });
    const id = st().addSystem('Base');
    st().toggleRoutineSystem('r1', id);
    st().deleteSystem(id);
    // The grouping goes; the practice does not.
    expect(st().systems).toHaveLength(0);
    expect(st().routines).toHaveLength(2);
    expect(routineSystemIds(st().routines[0])).toEqual([]);
  });
});

describe('a habit can be part of several systems', () => {
  it('joins more than one, and each membership is its own', () => {
    seed({ routines: [routine()] });
    const a = st().addSystem('Physical base');
    const b = st().addSystem('Get outside');
    st().toggleRoutineSystem('r1', a);
    st().toggleRoutineSystem('r1', b);
    expect(routineSystemIds(st().routines[0])).toEqual([a, b]);

    // Leaving one leaves the other standing.
    st().toggleRoutineSystem('r1', a);
    expect(routineSystemIds(st().routines[0])).toEqual([b]);
  });

  it('shows up under every system it is in', () => {
    seed({ routines: [routine()] });
    const a = st().addSystem('Physical base');
    const b = st().addSystem('Get outside');
    st().setRoutineSystems('r1', [a, b]);
    expect(systemRoutines(st().routines, a).map(r => r.id)).toEqual(['r1']);
    expect(systemRoutines(st().routines, b).map(r => r.id)).toEqual(['r1']);
  });

  it('reads a save written before it could', () => {
    // The legacy single field is understood without being rewritten on load.
    useQuestStore.setState({ routines: [routine({ id: 'r1', systemId: 'sys-old' })] } as never);
    expect(routineSystemIds(st().routines[0])).toEqual(['sys-old']);
    expect(systemRoutines(st().routines, 'sys-old')).toHaveLength(1);
  });

  it('retires the legacy field the first time membership is written', () => {
    useQuestStore.setState({ routines: [routine({ id: 'r1', systemId: 'sys-old' })] } as never);
    st().toggleRoutineSystem('r1', 'sys-new');
    expect(st().routines[0].systemId).toBeUndefined();
    expect(routineSystemIds(st().routines[0])).toEqual(['sys-old', 'sys-new']);
  });

  it('drops only the deleted system, keeping the rest', () => {
    seed({ routines: [routine()] });
    const a = st().addSystem('Physical base');
    const b = st().addSystem('Get outside');
    st().setRoutineSystems('r1', [a, b]);
    st().deleteSystem(a);
    expect(routineSystemIds(st().routines[0])).toEqual([b]);
  });

  it('lets several systems serve the same goal', () => {
    // The other direction of the same relaxation: a questline is not owned by
    // one system either.
    const a = st().addSystem('Physical base', { questlineIds: ['ql1'] });
    const b = st().addSystem('Kitchen', { questlineIds: ['ql1', 'ql2'] });
    const serving = st().systems.filter(sys => systemGoalIds(sys).includes('ql1')).map(sys => sys.id);
    expect(serving).toEqual([a, b]);
  });
});

describe('a system can serve several goals', () => {
  it('holds more than one', () => {
    const id = st().addSystem('Reading', { questlineIds: ['ql-books', 'ql-korean'] });
    expect(systemGoalIds(st().systems[0])).toEqual(['ql-books', 'ql-korean']);
    st().updateSystem(id, { questlineIds: ['ql-books'] });
    expect(systemGoalIds(st().systems[0])).toEqual(['ql-books']);
  });

  it('reads a save written before it could', () => {
    // The legacy single field is understood without being rewritten on load.
    useQuestStore.setState({ systems: [{ id: 'sys-old', title: 'Old', questlineId: 'ql1' }] } as never);
    expect(systemGoalIds(st().systems[0])).toEqual(['ql1']);
  });

  it('retires the legacy field the first time it is written', () => {
    useQuestStore.setState({ systems: [{ id: 'sys-old', title: 'Old', questlineId: 'ql1' }] } as never);
    st().updateSystem('sys-old', { questlineIds: ['ql1', 'ql2'] });
    expect(st().systems[0].questlineId).toBeUndefined();
    expect(systemGoalIds(st().systems[0])).toEqual(['ql1', 'ql2']);
  });

  it('drops only the deleted goal, keeping the rest', () => {
    const questline: Questline = { id: 'ql1', title: 'Health', description: '', icon: '', color: 'amber', quests: [] };
    seed({ questlines: [questline] });
    st().addSystem('Base', { questlineIds: ['ql1', 'ql2'] });
    st().deleteQuestline('ql1');
    expect(systemGoalIds(st().systems[0])).toEqual(['ql2']);
  });
});

describe('a system can feed a quest, not just a questline', () => {
  const withQuest = (): Questline => ({
    id: 'ql1', title: 'Learn Korean', description: '', icon: '', color: 'amber',
    quests: [
      { id: 'q1', title: 'Finish Hangul', description: '', order: 1, actions: [] },
      { id: 'q2', title: 'Hold a conversation', description: '', order: 2, actions: [] },
    ],
  });

  it('holds both attachments at once', () => {
    // The direction and one goal inside it are different claims, and a system is
    // allowed to make both.
    const id = st().addSystem('Daily study', { questlineIds: ['ql1'], questIds: ['q1'] });
    const sys = st().systems.find(s => s.id === id)!;
    expect(systemGoalIds(sys)).toEqual(['ql1']);
    expect(systemQuestIds(sys)).toEqual(['q1']);
  });

  it('defaults to feeding no quest', () => {
    const id = st().addSystem('Loose');
    expect(systemQuestIds(st().systems.find(s => s.id === id)!)).toEqual([]);
  });

  it('drops only the deleted quest', () => {
    seed({ questlines: [withQuest()] });
    st().addSystem('Study', { questIds: ['q1', 'q2'] });
    st().deleteQuest('ql1', 'q1');
    expect(systemQuestIds(st().systems[0])).toEqual(['q2']);
  });

  it('survives its quest being deleted', () => {
    seed({ questlines: [withQuest()] });
    const id = st().addSystem('Study', { questIds: ['q1'] });
    st().deleteQuest('ql1', 'q1');
    // The goal goes; the process that fed it does not.
    expect(st().systems.map(s => s.id)).toEqual([id]);
  });

  it('loses its quests when the whole questline goes', () => {
    seed({ questlines: [withQuest()] });
    st().addSystem('Study', { questlineIds: ['ql1'], questIds: ['q1', 'q2'] });
    st().deleteQuestline('ql1');
    expect(st().systems).toHaveLength(1);
    expect(systemGoalIds(st().systems[0])).toEqual([]);
    expect(systemQuestIds(st().systems[0])).toEqual([]);
  });

  it('keeps quests belonging to other questlines', () => {
    const other: Questline = {
      id: 'ql2', title: 'Fitness', description: '', icon: '', color: 'emerald',
      quests: [{ id: 'q9', title: 'Squat 100kg', description: '', order: 1, actions: [] }],
    };
    seed({ questlines: [withQuest(), other] });
    st().addSystem('Study', { questIds: ['q1', 'q9'] });
    st().deleteQuestline('ql1');
    expect(systemQuestIds(st().systems[0])).toEqual(['q9']);
  });
});

describe('an anchor habit can also serve a goal', () => {
  it('keeps the anchor flag when a questline is set', () => {
    seed({ routines: [routine({ id: 'r1', anchor: true })] });
    st().updateRoutine('r1', { questlineId: 'ql1' });
    // These used to be exclusive: filing it under a goal silently un-anchored it.
    expect(st().routines[0].anchor).toBe(true);
    expect(st().routines[0].questlineId).toBe('ql1');
  });

  it('and can be given a quest as well', () => {
    seed({ routines: [routine({ id: 'r1', anchor: true })] });
    st().updateRoutine('r1', { questlineId: 'ql1', questId: 'q1' });
    expect(st().routines[0].anchor).toBe(true);
    expect(st().routines[0].questId).toBe('q1');
  });

  it('still clears the quest when the questline is removed', () => {
    seed({ routines: [routine({ id: 'r1', anchor: true, questlineId: 'ql1', questId: 'q1' })] });
    st().updateRoutine('r1', { questlineId: null });
    expect(st().routines[0].questId).toBeUndefined();
    expect(st().routines[0].anchor).toBe(true);
  });
});

describe('actions created inside a system', () => {
  it('lands in the system with the frequency it was given', () => {
    const id = st().addSystem('Physical base');
    st().addSystemAction(id, 'Go to the gym', 'weekly');
    const r = st().routines[0];
    expect(routineSystemIds(r)).toEqual([id]);
    expect(r.title).toBe('Go to the gym');
    expect(r.recurring).toBe('weekly');
    // Stamped so its consistency is never scored over days it didn't exist for.
    expect(r.createdAt).toBeTruthy();
    // On Today from the start — naming it is saying you mean to do it.
    expect(r.trackedToday).toBe(true);
  });

  it('takes a custom interval', () => {
    const id = st().addSystem('Upkeep');
    st().addSystemAction(id, 'Deep clean', null, 10);
    expect(st().routines[0].intervalDays).toBe(10);
  });

  it('ignores an interval of one, which is just daily', () => {
    const id = st().addSystem('Upkeep');
    st().addSystemAction(id, 'Tidy', 'daily', 1);
    expect(st().routines[0].intervalDays).toBeUndefined();
  });

  it('survives its system being deleted', () => {
    const id = st().addSystem('Physical base');
    st().addSystemAction(id, 'Go to the gym', 'weekly');
    st().deleteSystem(id);
    expect(st().routines).toHaveLength(1);
    expect(routineSystemIds(st().routines[0])).toEqual([]);
  });
});

describe('the same habit, entered twice', () => {
  it('joins the existing task instead of making a second one', () => {
    // Typing a habit you already have into a system is a request for *that*
    // habit to be part of *this* system — which one task can now be.
    seed({ routines: [routine({ id: 'r1', title: 'Read 30 minutes', streak: 9 })] });
    const sys = st().addSystem('Reading');
    st().addSystemAction(sys, 'Read 30 mins', 'daily');

    expect(st().routines).toHaveLength(1);
    expect(st().routines[0].streak).toBe(9);          // and it keeps what it had
    expect(routineSystemIds(st().routines[0])).toEqual([sys]);
  });

  it('still creates one when the name is genuinely new', () => {
    seed({ routines: [routine({ id: 'r1', title: 'Read 30 minutes' })] });
    const sys = st().addSystem('Reading');
    st().addSystemAction(sys, 'Read 15 minutes', 'daily');
    expect(st().routines).toHaveLength(2);
  });

  it('merges two copies without losing either one’s history', () => {
    seed({
      routines: [
        routine({ id: 'a', title: 'Read 30 minutes', streak: 3, questlineId: 'ql1', systemIds: ['s1'] }),
        routine({ id: 'b', title: 'Read 30 mins', streak: 11, systemIds: ['s2'] }),
      ],
      taskHistory: { a: ['2026-08-01', '2026-08-02'], b: ['2026-08-02', '2026-08-03'] },
      todoOrder: { a: 0, b: 1 },
    } as never);

    st().mergeRoutines('a', 'b');

    expect(st().routines).toHaveLength(1);
    const merged = st().routines[0];
    expect(merged.id).toBe('a');
    expect(routineSystemIds(merged)).toEqual(['s1', 's2']);   // both systems
    expect(merged.streak).toBe(11);                            // the better streak
    expect(merged.questlineId).toBe('ql1');
    // The union of the days, counted once each.
    expect(st().taskHistory.a).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
    expect(st().taskHistory.b).toBeUndefined();
    expect(st().todoOrder.b).toBeUndefined();
  });

  it('counts a tick on either copy as done', () => {
    seed({ routines: [
      routine({ id: 'a', title: 'Walk', completed: false }),
      routine({ id: 'b', title: 'walk', completed: true, completedAt: '2026-08-16T09:00:00.000Z' }),
    ] });
    st().mergeRoutines('a', 'b');
    expect(st().routines[0].completed).toBe(true);
    expect(st().routines[0].completedAt).toBeTruthy();
  });

  it('refuses to merge a task into itself', () => {
    seed({ routines: [routine({ id: 'a', title: 'Walk' })] });
    st().mergeRoutines('a', 'a');
    expect(st().routines).toHaveLength(1);
  });
});

describe('deleting a goal', () => {
  it('detaches the systems that served it instead of taking them down', () => {
    const questline: Questline = { id: 'ql1', title: 'Health', description: '', icon: '', color: 'amber', quests: [] };
    seed({ questlines: [questline] });
    const id = st().addSystem('Base', { questlineIds: ['ql1'] });
    st().deleteQuestline('ql1');
    expect(st().questlines).toHaveLength(0);
    expect(st().systems).toHaveLength(1);
    expect(st().systems[0].id).toBe(id);
    expect(systemGoalIds(st().systems[0])).toEqual([]);
  });
});

describe('retiring the anchor system', () => {
  /** The state left behind by the seed this migration reverses. */
  const seeded = (over: Partial<Routine> = {}) => {
    const sys = { id: 'sys-anchor', title: ANCHOR_LABEL, order: 0 };
    useQuestStore.setState({
      questlines: [], systems: [sys], completionLog: {}, taskHistory: {}, todoOrder: {},
      anchorSystemRetired: undefined,
      routines: [
        routine({ id: 'a1', title: 'Read', systemIds: ['sys-anchor'], ...over }),
        routine({ id: 'a2', title: 'Water', systemIds: ['sys-anchor', 'sys-other'] }),
        routine({ id: 'r9', title: 'Unrelated' }),
      ],
    } as never);
  };

  it('deletes the system and marks its members for the Today section', () => {
    seeded();
    st().checkAndResetRecurring();

    expect(st().systems).toHaveLength(0);
    const a1 = st().routines.find(r => r.id === 'a1')!;
    expect(a1.anchor).toBe(true);
    expect(routineSystemIds(a1)).toEqual([]);
  });

  it('keeps every other system the habit was in', () => {
    seeded();
    st().checkAndResetRecurring();
    const a2 = st().routines.find(r => r.id === 'a2')!;
    expect(a2.anchor).toBe(true);
    expect(routineSystemIds(a2)).toEqual(['sys-other']);
  });

  it('leaves tasks that were never in it alone', () => {
    seeded();
    st().checkAndResetRecurring();
    const r9 = st().routines.find(r => r.id === 'r9')!;
    expect(r9.anchor).toBeUndefined();
  });

  it('keeps the habits, their streaks and their history', () => {
    seeded({ streak: 14 });
    st().checkAndResetRecurring();
    expect(st().routines).toHaveLength(3);
    expect(st().routines.find(r => r.id === 'a1')!.streak).toBe(14);
  });

  it('does not run twice, so a system you rebuild by hand survives', () => {
    seeded();
    st().checkAndResetRecurring();
    const rebuilt = st().addSystem(ANCHOR_LABEL);
    st().checkAndResetRecurring();
    expect(st().systems.map(s => s.id)).toEqual([rebuilt]);
  });

  it('does nothing when there was never one', () => {
    seed({ routines: [routine({ id: 'r9', title: 'Unrelated' })] });
    st().checkAndResetRecurring();
    expect(st().systems).toHaveLength(0);
    expect(st().routines[0].anchor).toBeUndefined();
  });
});
