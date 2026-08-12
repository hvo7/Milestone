/**
 * Undo, end to end through the real stores.
 *
 * The interesting part isn't "does the item come back" — it's the cascade.
 * Deleting a questline also deletes every routine linked to it and detaches every
 * routine pointing at one of its quests; an undo that restores the questline and
 * nothing else looks like it worked and quietly isn't.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useQuestStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { useUndoStore, insertAt, reinsert, captureRemoved, deleteLabel, countLabel } from './undo';
import type { Questline, Routine } from '../types';

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Task', recurring: null, completed: false, trackedToday: false, ...over,
});

const questline = (over: Partial<Questline> = {}): Questline => ({
  id: 'ql', title: 'Health', description: '', icon: '', color: 'amber', quests: [], ...over,
});

const reset = () => {
  useQuestStore.setState({ questlines: [], routines: [], completionLog: {}, taskHistory: {}, todoOrder: {} });
  useVynuesStore.setState({ projects: [] });
  useUndoStore.getState().dismiss();
};

beforeEach(reset);

const undo = () => useUndoStore.getState().run();
const label = () => useUndoStore.getState().entry?.label;

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('insertAt', () => {
  it('inserts at the index', () => {
    expect(insertAt(['a', 'b', 'c'], 1, 'x')).toEqual(['a', 'x', 'b', 'c']);
  });

  it('clamps past the end rather than leaving a hole', () => {
    // The list may have shrunk since the item was captured.
    expect(insertAt(['a'], 9, 'x')).toEqual(['a', 'x']);
    expect(insertAt(['a'], -3, 'x')).toEqual(['x', 'a']);
  });
});

describe('reinsert', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  it('restores several items to their original positions', () => {
    const removed = captureRemoved(items, i => i.id === 'b' || i.id === 'd');
    const after = items.filter(i => i.id !== 'b' && i.id !== 'd');
    expect(reinsert(after, removed).map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never duplicates an id that came back by other means', () => {
    // Whatever ran between the delete and the undo, a restore must not be able to
    // produce two rows with the same id.
    const removed = captureRemoved(items, i => i.id === 'b');
    expect(reinsert(items, removed).map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('deleteLabel', () => {
  it('omits an empty cascade', () => {
    expect(deleteLabel('Gym')).toBe('Deleted “Gym”');
  });

  it('names only the non-zero parts, pluralised', () => {
    expect(deleteLabel('Health', [[4, 'quest'], [0, 'task']])).toBe('Deleted “Health” · 4 quests');
    expect(deleteLabel('Health', [[1, 'quest'], [3, 'task']])).toBe('Deleted “Health” · 1 quest, 3 tasks');
  });

  it('takes an irregular plural', () => {
    expect(countLabel(2, 'entry', 'entries')).toBe('2 entries');
    expect(countLabel(1, 'entry', 'entries')).toBe('1 entry');
  });
});

// ── Quest store ──────────────────────────────────────────────────────────────

describe('deleteQuestline', () => {
  const seed = () => useQuestStore.setState({
    questlines: [
      questline({ id: 'ql1', title: 'Health', quests: [
        { id: 'q1', title: 'Q1', description: '', order: 1, actions: [{ id: 'a1', title: 'A', completed: false }] },
        { id: 'q2', title: 'Q2', description: '', order: 2, actions: [] },
      ] }),
      questline({ id: 'ql2', title: 'Learning' }),
    ],
    routines: [
      routine({ id: 'r1', title: 'Loose' }),
      routine({ id: 'r2', title: 'Linked', questlineId: 'ql1' }),
      routine({ id: 'r3', title: 'After' }),
    ],
  });

  it('takes the linked routines with it', () => {
    seed();
    useQuestStore.getState().deleteQuestline('ql1');
    expect(useQuestStore.getState().routines.map(r => r.id)).toEqual(['r1', 'r3']);
  });

  it('names the cascade, so the cost is visible after the fact', () => {
    seed();
    useQuestStore.getState().deleteQuestline('ql1');
    expect(label()).toBe('Deleted “Health” · 2 quests, 1 task');
  });

  it('restores the questline and its routines, in place', () => {
    seed();
    useQuestStore.getState().deleteQuestline('ql1');
    undo();
    const s = useQuestStore.getState();
    expect(s.questlines.map(q => q.id)).toEqual(['ql1', 'ql2']);
    // Position matters: r2 belongs between r1 and r3, not appended at the end.
    expect(s.routines.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(s.questlines[0].quests).toHaveLength(2);
  });

  it('keeps edits made in the undo window', () => {
    seed();
    useQuestStore.getState().deleteQuestline('ql1');
    useQuestStore.getState().updateRoutineTitle('r3', 'Renamed');
    undo();
    const s = useQuestStore.getState();
    expect(s.routines.find(r => r.id === 'r3')?.title).toBe('Renamed');
    expect(s.routines.map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('is a no-op when run twice', () => {
    seed();
    useQuestStore.getState().deleteQuestline('ql1');
    undo();
    undo();   // the entry is consumed; a second press must not duplicate anything
    expect(useQuestStore.getState().questlines.map(q => q.id)).toEqual(['ql1', 'ql2']);
    expect(useQuestStore.getState().routines).toHaveLength(3);
  });
});

describe('deleteQuest', () => {
  const seed = () => useQuestStore.setState({
    questlines: [questline({ quests: [
      { id: 'q1', title: 'First', description: '', order: 1, actions: [] },
      { id: 'q2', title: 'Second', description: '', order: 2, actions: [{ id: 'a1', title: 'A', completed: false }] },
      { id: 'q3', title: 'Third', description: '', order: 3, actions: [] },
    ] })],
    routines: [routine({ id: 'r1', questlineId: 'ql', questId: 'q2' })],
  });

  it('re-attaches exactly the routines it detached', () => {
    seed();
    useQuestStore.getState().deleteQuest('ql', 'q2');
    expect(useQuestStore.getState().routines[0].questId).toBeUndefined();
    undo();
    expect(useQuestStore.getState().routines[0].questId).toBe('q2');
  });

  it('does not steal back a routine re-filed in the meantime', () => {
    seed();
    useQuestStore.getState().deleteQuest('ql', 'q2');
    useQuestStore.getState().setRoutineQuest('r1', 'q1');
    undo();
    // It has a home now; the undo must not drag it back to the restored quest.
    expect(useQuestStore.getState().routines[0].questId).toBe('q1');
  });

  it('restores order numbers as a contiguous run', () => {
    seed();
    useQuestStore.getState().deleteQuest('ql', 'q2');
    expect(useQuestStore.getState().questlines[0].quests.map(q => q.order)).toEqual([1, 2]);
    undo();
    const quests = useQuestStore.getState().questlines[0].quests;
    expect(quests.map(q => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(quests.map(q => q.order)).toEqual([1, 2, 3]);
  });
});

describe('deleteRoutine', () => {
  it('names the streak, which is the part that cannot be retyped', () => {
    useQuestStore.setState({ routines: [routine({ id: 'r1', title: 'Read', streak: 34 })] });
    useQuestStore.getState().deleteRoutine('r1');
    expect(label()).toBe('Deleted “Read” · 34-day streak');
  });

  it('says nothing about a streak of one', () => {
    useQuestStore.setState({ routines: [routine({ id: 'r1', title: 'Read', streak: 1 })] });
    useQuestStore.getState().deleteRoutine('r1');
    expect(label()).toBe('Deleted “Read”');
  });

  it('brings the streak back with the task', () => {
    useQuestStore.setState({ routines: [routine({ id: 'r0' }), routine({ id: 'r1', title: 'Read', streak: 34 }), routine({ id: 'r2' })] });
    useQuestStore.getState().deleteRoutine('r1');
    undo();
    const s = useQuestStore.getState();
    expect(s.routines.map(r => r.id)).toEqual(['r0', 'r1', 'r2']);
    expect(s.routines[1].streak).toBe(34);
  });
});

describe('deleteAction', () => {
  it('puts the action back where it was', () => {
    useQuestStore.setState({ questlines: [questline({ quests: [{
      id: 'q1', title: 'Q', description: '', order: 1,
      actions: [
        { id: 'a1', title: 'One', completed: false },
        { id: 'a2', title: 'Two', completed: false },
        { id: 'a3', title: 'Three', completed: false },
      ],
    }] })] });
    useQuestStore.getState().deleteAction('ql', 'q1', 'a2');
    expect(label()).toBe('Deleted “Two”');
    undo();
    expect(useQuestStore.getState().questlines[0].quests[0].actions.map(a => a.id)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('deleteRoutineSubtask', () => {
  it('restores the tree and the roll-up it drove', () => {
    useQuestStore.setState({ routines: [routine({
      id: 'r1',
      completed: false,
      subtasks: [
        { id: 's1', title: 'One', completed: true },
        { id: 's2', title: 'Two', completed: false },
      ],
    })] });
    // Deleting the only open step completes the task by roll-up…
    useQuestStore.getState().deleteRoutineSubtask('r1', 's2');
    expect(useQuestStore.getState().routines[0].completed).toBe(true);
    // …so undo has to take that back too, not just the step.
    undo();
    const r = useQuestStore.getState().routines[0];
    expect(r.subtasks?.map(s => s.id)).toEqual(['s1', 's2']);
    expect(r.completed).toBe(false);
  });

  it('leaves a rename made in the meantime alone', () => {
    useQuestStore.setState({ routines: [routine({ id: 'r1', title: 'Old', subtasks: [{ id: 's1', title: 'One', completed: false }] })] });
    useQuestStore.getState().deleteRoutineSubtask('r1', 's1');
    useQuestStore.getState().updateRoutineTitle('r1', 'New');
    undo();
    expect(useQuestStore.getState().routines[0].title).toBe('New');
    expect(useQuestStore.getState().routines[0].subtasks).toHaveLength(1);
  });
});

// ── Vynues store ─────────────────────────────────────────────────────────────

describe('vynues deletes', () => {
  const seedProject = () => useVynuesStore.setState({
    projects: [
      { id: 'p1', name: 'Website', description: '', color: 'sapphire', status: 'active', createdAt: '', tasks: [
        { id: 't1', title: 'Design', done: false, priority: 'medium', createdAt: '' },
        { id: 't2', title: 'Build', done: false, priority: 'medium', createdAt: '' },
      ] },
      { id: 'p2', name: 'Other', description: '', color: 'amber', status: 'active', createdAt: '', tasks: [] },
    ],
  });

  it('restores a project with all its tasks, in place', () => {
    seedProject();
    useVynuesStore.getState().deleteProject('p1');
    expect(label()).toBe('Deleted “Website” · 2 tasks');
    undo();
    const projects = useVynuesStore.getState().projects;
    expect(projects.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(projects[0].tasks).toHaveLength(2);
  });

  it('restores a task at its original index', () => {
    seedProject();
    useVynuesStore.getState().deleteTask('p1', 't1');
    undo();
    expect(useVynuesStore.getState().projects[0].tasks.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('restores a subtask and un-does the roll-up it caused', () => {
    useVynuesStore.setState({ projects: [{
      id: 'p1', name: 'P', description: '', color: 'amber', status: 'active', createdAt: '',
      tasks: [{ id: 't1', title: 'T', done: false, priority: 'medium', createdAt: '', subtasks: [
        { id: 's1', title: 'One', done: true },
        { id: 's2', title: 'Two', done: false },
      ] }],
    }] });
    useVynuesStore.getState().deleteSubtask('p1', 't1', 's2');
    expect(useVynuesStore.getState().projects[0].tasks[0].done).toBe(true);
    undo();
    const task = useVynuesStore.getState().projects[0].tasks[0];
    expect(task.subtasks?.map(s => s.id)).toEqual(['s1', 's2']);
    expect(task.done).toBe(false);
  });
});

// ── The offer itself ─────────────────────────────────────────────────────────

describe('the undo slot', () => {
  it('holds only the most recent action', () => {
    useQuestStore.setState({ routines: [routine({ id: 'r1', title: 'First' }), routine({ id: 'r2', title: 'Second' })] });
    useQuestStore.getState().deleteRoutine('r1');
    useQuestStore.getState().deleteRoutine('r2');
    expect(label()).toBe('Deleted “Second”');
    undo();
    // Only the second comes back — the first is past the one offer it got.
    expect(useQuestStore.getState().routines.map(r => r.id)).toEqual(['r2']);
    expect(useUndoStore.getState().entry).toBeNull();
  });

  it('offers nothing for a delete that matched nothing', () => {
    useQuestStore.setState({ routines: [] });
    useQuestStore.getState().deleteRoutine('nope');
    expect(useUndoStore.getState().entry).toBeNull();
  });
});
