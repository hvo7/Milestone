/**
 * The app-wide undo.
 *
 * These drive the real stores rather than a stand-in, because the whole claim of
 * this module is "anything that changes the data is undoable" — a fake store
 * would only prove the stack works on a fake store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useQuestStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { startHistory, undo, redo, canUndo, canRedo, clearHistory, withoutHistory, COALESCE_MS, MAX_STEPS } from './history';

const st = () => useQuestStore.getState();
const titles = () => st().routines.map(r => r.title);

/** Past the coalescing window, so the next write is its own step. */
const settle = () => vi.advanceTimersByTime(COALESCE_MS + 10);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 16, 12));
  useQuestStore.setState({
    questlines: [], routines: [], systems: [], completionLog: {}, taskHistory: {}, todoOrder: {},
  } as never);
  useVynuesStore.setState({ projects: [] } as never);
  startHistory();
  clearHistory();
});
afterEach(() => { vi.useRealTimers(); });

describe('stepping back', () => {
  it('undoes a change nobody wrote an inverse for', () => {
    st().addRoutine('Read', '', 'daily');
    expect(titles()).toEqual(['Read']);

    expect(undo()).toBe(true);
    expect(titles()).toEqual([]);
  });

  it('and redoes it', () => {
    st().addRoutine('Read', '', 'daily');
    undo();
    expect(redo()).toBe(true);
    expect(titles()).toEqual(['Read']);
  });

  it('walks back through several changes in order', () => {
    st().addRoutine('One', '', 'daily'); settle();
    st().addRoutine('Two', '', 'daily'); settle();
    st().addRoutine('Three', '', 'daily');

    undo(); expect(titles()).toEqual(['One', 'Two']);
    undo(); expect(titles()).toEqual(['One']);
    undo(); expect(titles()).toEqual([]);
    expect(undo()).toBe(false);   // and stops at the state it started from
  });

  it('reports whether there is anywhere to go', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    st().addRoutine('Read', '', 'daily');
    expect(canUndo()).toBe(true);
    undo();
    expect(canRedo()).toBe(true);
  });

  it('drops the redo branch once you change something else', () => {
    st().addRoutine('One', '', 'daily'); settle();
    undo();
    expect(canRedo()).toBe(true);
    st().addRoutine('Other', '', 'daily');
    expect(canRedo()).toBe(false);
  });
});

describe('what counts as one step', () => {
  it('folds a burst of writes into the gesture that made them', () => {
    // A drag fires a reorder per frame; one Ctrl+Z should undo the drag.
    st().addRoutine('Anchor', '', 'daily');
    settle();
    for (let i = 0; i < 5; i++) {
      st().addRoutine(`Rapid ${i}`, '', 'daily');
      vi.advanceTimersByTime(20);
    }
    expect(titles()).toHaveLength(6);
    undo();
    // The whole burst goes, back to the state before it started.
    expect(titles()).toEqual(['Anchor']);
  });

  it('keeps deliberate changes apart', () => {
    st().addRoutine('One', '', 'daily'); settle();
    st().addRoutine('Two', '', 'daily'); settle();
    undo();
    expect(titles()).toEqual(['One']);
  });

  it('forgets the oldest step once the stack is full', () => {
    for (let i = 0; i <= MAX_STEPS + 4; i++) {
      st().addRoutine(`T${i}`, '', 'daily');
      settle();
    }
    let steps = 0;
    while (undo()) steps++;
    expect(steps).toBe(MAX_STEPS);
    // The early ones are past the horizon and stay put, rather than vanishing.
    expect(titles().length).toBeGreaterThan(0);
  });
});

describe('what stays out of it', () => {
  it('ignores work the app does on its own behalf', () => {
    withoutHistory(() => st().addRoutine('Rollover', '', 'daily'));
    expect(canUndo()).toBe(false);
    expect(titles()).toEqual(['Rollover']);
  });

  it('creates no step of its own', () => {
    st().addRoutine('Mine', '', 'daily');
    settle();
    withoutHistory(() => st().addRoutine('Automatic', '', 'daily'));
    settle();
    // One step on the stack, not two: the automatic change isn't somewhere you
    // can land.
    expect(undo()).toBe(true);
    expect(canUndo()).toBe(false);
  });

  it('is carried back with you when you step past it', () => {
    // The honest limit of restoring state rather than replaying inverses: a step
    // recorded before an automatic change describes a world without it, so
    // returning there un-does it too. Safe for the two cases this has:
    // the 5am rollover is derived from the clock and re-applies itself within the
    // minute, and an incoming cloud sync clears the history outright rather than
    // letting Ctrl+Z reach across it (see cloudSync.applyStores).
    st().addRoutine('Mine', '', 'daily');
    settle();
    withoutHistory(() => st().addRoutine('Automatic', '', 'daily'));
    settle();
    undo();
    expect(titles()).toEqual([]);
  });

  it('clears away entirely when the ground moves', () => {
    st().addRoutine('Mine', '', 'daily');
    expect(canUndo()).toBe(true);
    clearHistory();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it('leaves recording off until the outermost call finishes', () => {
    withoutHistory(() => {
      withoutHistory(() => st().addRoutine('Inner', '', 'daily'));
      st().addRoutine('Outer', '', 'daily');
    });
    expect(canUndo()).toBe(false);
  });

  it('does not record the restore itself', () => {
    st().addRoutine('Read', '', 'daily');
    undo();
    // Undo leaves one place to go — forwards. If applying a snapshot were
    // recorded, this would have grown a step and redo would be unreachable.
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
  });
});

describe('across both stores', () => {
  it('undoes a Vynues change too', () => {
    useVynuesStore.getState().addProject('Website', '', 'sapphire');
    expect(useVynuesStore.getState().projects).toHaveLength(1);
    undo();
    expect(useVynuesStore.getState().projects).toHaveLength(0);
  });

  it('restores the other store as it was, not as it is', () => {
    st().addRoutine('Task', '', 'daily');
    settle();
    useVynuesStore.getState().addProject('Website', '', 'sapphire');
    settle();
    undo();
    // Stepping back over the project must not take the task with it.
    expect(useVynuesStore.getState().projects).toHaveLength(0);
    expect(titles()).toEqual(['Task']);
  });
});
