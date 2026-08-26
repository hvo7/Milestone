/**
 * When two tasks are the same task.
 *
 * The rule decides whether the app offers to delete one of your habits, so both
 * directions matter: the near-misses it has to catch, and the genuinely
 * different tasks it must never suggest folding together.
 */
import { describe, it, expect } from 'vitest';
import { canonical, sameTitle, duplicateGroups } from './duplicates';
import type { Routine } from '../types';

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1', title: 'Habit', recurring: 'daily', completed: false, trackedToday: true, streak: 0, ...over,
});

describe('the same thing, typed differently', () => {
  it('matches an abbreviation against the word', () => {
    expect(sameTitle('Read 30 mins', 'Read 30 Minutes')).toBe(true);
    expect(sameTitle('Work for 1 hr', 'Work for 1 hour')).toBe(true);
    expect(sameTitle('Drink 64 oz of water', 'Drink 64 ounces water')).toBe(true);
  });

  it('ignores case, punctuation and filler', () => {
    expect(sameTitle('Read 30 minutes each day', 'read 30 minutes, daily')).toBe(false);   // "daily" ≠ "day"
    expect(sameTitle('Read 30 minutes each day', 'Read 30 Minutes — a day!')).toBe(true);
    expect(sameTitle('Go to the Gym 3 times', 'Go to Gym 3x')).toBe(true);
  });

  it('ignores the order the words were put in', () => {
    expect(sameTitle('Read 30 minutes each day', 'Daily: 30 minutes read')).toBe(false);
    expect(sameTitle('Sunny walk', 'Walk, sunny')).toBe(true);
  });

  it('keeps different tasks apart', () => {
    expect(sameTitle('Read 30 minutes', 'Read 15 minutes')).toBe(false);
    expect(sameTitle('Go to the gym', 'Go to the shop')).toBe(false);
    expect(sameTitle('Stretch', 'Stretch hamstrings')).toBe(false);
  });

  it('never matches on nothing', () => {
    expect(canonical('  ')).toBe('');
    expect(sameTitle('', '')).toBe(false);
    expect(sameTitle('the a of', '!!!')).toBe(false);
  });
});

describe('grouping what to offer', () => {
  const history = { a: ['2026-08-01', '2026-08-02', '2026-08-03'], b: ['2026-08-02'] };

  it('finds a pair and keeps the one with the most history', () => {
    const rs = [routine({ id: 'a', title: 'Read 30 minutes' }), routine({ id: 'b', title: 'Read 30 mins' })];
    const [group] = duplicateGroups(rs, history);
    expect(group.keep.id).toBe('a');
    expect(group.drop.map(r => r.id)).toEqual(['b']);
  });

  it('falls back to the longer streak when neither has history', () => {
    const rs = [routine({ id: 'a', title: 'Stretch', streak: 2 }), routine({ id: 'b', title: 'stretch', streak: 9 })];
    expect(duplicateGroups(rs).map(g => g.keep.id)).toEqual(['b']);
  });

  it('handles three copies as one group', () => {
    const rs = [
      routine({ id: 'a', title: 'Read 30 minutes' }),
      routine({ id: 'b', title: 'Read 30 mins' }),
      routine({ id: 'c', title: 'read 30 minute' }),
    ];
    const groups = duplicateGroups(rs, history);
    expect(groups).toHaveLength(1);
    expect(groups[0].drop).toHaveLength(2);
  });

  it('says nothing when every task is its own', () => {
    const rs = [routine({ id: 'a', title: 'Read' }), routine({ id: 'b', title: 'Walk' })];
    expect(duplicateGroups(rs)).toEqual([]);
  });

  it('leaves hidden tasks out of it', () => {
    const rs = [routine({ id: 'a', title: 'Read 30 mins' }), routine({ id: 'b', title: 'Read 30 minutes', hidden: true })];
    expect(duplicateGroups(rs)).toEqual([]);
  });
});
