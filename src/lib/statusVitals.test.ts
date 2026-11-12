import { describe, expect, it } from 'vitest';
import { attentionReason, choosePriority, historyEntries, loadStatusVitals, newStatusVital, nextVitalAction, saveCheckIn, statusPace, statusVitalsKey, validStatusVitals } from './statusVitals';
import { newVital, simpleVitalsKey } from './simpleVitals';
import { lifeVitalsStorageKey } from './lifeVitalsStorage';
import { lifeVitalsExamples } from '../testing/lifeVitalsExamples';

const area = () => ({ ...newStatusVital(), name: 'School', onPace: 'Stay caught up' });
const store = (values: Record<string, string> = {}) => ({ getItem: (key: string) => values[key] ?? null });
const firstTime = '2026-11-09T12:00:00Z';
const secondTime = '2026-11-10T12:00:00Z';

it.each([false, true])('finds the first unfinished action in saved order (sequential=%s)', sequential => {
  const a = saveCheckIn({ ...area(), plans: {
    catchUp: { sequential, tasks: [
      { id: 'done', title: 'Finished', done: true, subtasks: [] },
      { id: 'parent', title: 'Lecture', done: false, subtasks: [{ id: 's1', title: 'Read', done: true }, { id: 's2', title: 'Practice', done: false }] },
      { id: 'later', title: 'Assignment', done: false, subtasks: [] },
    ] }, maintenance: { sequential: false, tasks: [{ id: 'm', title: 'Weekly review', done: false, subtasks: [] }] },
  } }, { status: 'behind', reason: '', next: '' });
  expect(nextVitalAction(a)).toBe('Lecture: Practice');
  a.plans!.catchUp.tasks[1].subtasks[1].done = true;
  expect(nextVitalAction(a)).toBe('Assignment');
  a.plans!.catchUp.tasks[2].done = true;
  expect(nextVitalAction(a)).toBeNull();
  a.entries[0].status = 'on-pace';
  expect(nextVitalAction(a)).toBe('Weekly review');
  a.entries[0].status = 'ahead';
  expect(nextVitalAction(a)).toBeNull();
  expect(nextVitalAction(area())).toBeNull();
  expect(nextVitalAction({ ...a, archived: true })).toBeNull();
});

it('identifies behind, unreviewed and seven-day-old areas without changing their status', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const fresh = saveCheckIn(area(), { status: 'ahead', reason: '', next: '' }, undefined, secondTime);
  const old = saveCheckIn(area(), { status: 'on-pace', reason: '', next: '' }, undefined, '2026-11-04T12:00:00Z');
  expect(attentionReason(area(), now)).toBe('Not checked yet');
  expect(attentionReason(fresh, now)).toBeNull();
  expect(attentionReason(old, now - 1)).toBeNull();
  expect(attentionReason(old, now)).toBe('Review due (7+ days)');
  expect(statusPace(old)).toBe('on-pace');
  expect(attentionReason({ ...old, archived: true }, now)).toBeNull();
  expect(attentionReason(saveCheckIn(area(), { status: 'behind', reason: '', next: '' }), now)).toBe('Behind');
});

it('keeps at most one non-archived priority and preserves plans and history', () => {
  const a = area(), b = area();
  let areas = choosePriority([a, b], a.id);
  areas = choosePriority(areas, b.id);
  expect(areas.map(x => x.priority)).toEqual([false, true]);
  expect(areas[1].entries).toEqual(b.entries);
  expect(validStatusVitals(areas)).toBe(true);
  expect(choosePriority(areas, 'missing')).toBe(areas);
  expect(choosePriority(areas, '').every(x => !x.priority)).toBe(true);
  expect(validStatusVitals(areas.map(x => ({ ...x, priority: true })))).toBe(false);
  expect(validStatusVitals([{ ...b, priority: true, archived: true }])).toBe(false);
});

describe('status check-in history', () => {
  it('starts unassessed, records a chosen status and keeps past check-ins', () => {
    const initial = area();
    expect(statusPace(initial)).toBe('unrated');
    const first = saveCheckIn(initial, { status: 'behind', reason: ' Two lectures behind ', next: ' Review tonight ' }, undefined, firstTime);
    const second = saveCheckIn(first, { status: 'on-pace', reason: 'Caught up', next: '' }, undefined, secondTime);
    expect(initial.entries).toHaveLength(0);
    expect(first.entries[0]).toMatchObject({ status: 'behind', reason: 'Two lectures behind', next: 'Review tonight', onPace: 'Stay caught up' });
    expect(second.entries).toHaveLength(2);
    expect(statusPace(second)).toBe('on-pace');
  });
  it('editing older history keeps its date, personal definition, and current status', () => {
    const first = saveCheckIn(area(), { status: 'behind', reason: '', next: '' }, undefined, firstTime);
    const second = saveCheckIn({ ...first, onPace: 'Submit on time' }, { status: 'ahead', reason: '', next: '' }, undefined, secondTime);
    const edited = saveCheckIn(second, { status: 'on-pace', reason: 'Correction', next: '' }, first.entries[0].id, '2026-11-11T12:00:00Z');
    expect(edited.entries).toHaveLength(2);
    expect(statusPace(edited)).toBe('ahead');
    expect(historyEntries(edited)[1]).toMatchObject({ createdAt: firstTime, onPace: 'Stay caught up', reason: 'Correction' });
    expect(() => saveCheckIn(edited, { status: 'behind', reason: '', next: '' }, 'missing')).toThrow();
  });
  it('accepts optional fields, rejects invalid status, invalid timestamps and duplicate entries', () => {
    const a = saveCheckIn(area(), { status: 'ahead', reason: '', next: '' }, undefined, firstTime);
    expect(validStatusVitals([a])).toBe(true);
    expect(validStatusVitals([{ ...a, entries: [a.entries[0], a.entries[0]] }])).toBe(false);
    expect(validStatusVitals([{ ...a, entries: [{ ...a.entries[0], status: 'auto' }] }])).toBe(false);
    expect(validStatusVitals([{ ...a, entries: [{ ...a.entries[0], createdAt: 'bad date' }] }])).toBe(false);
    expect(validStatusVitals([{ ...a, name: ' ' }])).toBe(false);
  });
  it('keeps production empty despite testing data; empty saved lists stay empty', () => {
    const testing = loadStatusVitals(store(), true);
    expect(validStatusVitals(testing)).toBe(true);
    expect(loadStatusVitals(store({ [statusVitalsKey(true)]: JSON.stringify(testing) }), false)).toEqual([]);
    expect(loadStatusVitals(store({ [statusVitalsKey(true)]: '[]' }), true)).toEqual([]);
  });
  it('preserves old checklist names, archive state, definition and dated status without writing old storage', () => {
    const old = { ...newVital(), name: 'My gym', archived: true, checkedAt: firstTime, extra: true };
    old.checks[0].done = true;
    const raw = JSON.stringify([old]);
    const storage = store({ [simpleVitalsKey(true)]: raw });
    const migrated = loadStatusVitals(storage, true)[0];
    expect(migrated).toMatchObject({ name: 'My gym', archived: true, onPace: 'I did what I planned' });
    expect(migrated.entries[0]).toMatchObject({ status: 'ahead', createdAt: firstTime });
    expect(storage.getItem(simpleVitalsKey(true))).toBe(raw);
  });
  it('does not invent historical dates for detailed areas', () => {
    const previous = lifeVitalsExamples();
    const migrated = loadStatusVitals(store({ [lifeVitalsStorageKey(true)]: JSON.stringify(previous) }), true);
    expect(migrated[0].name).toBe(previous[0].name);
    expect(migrated[0].entries).toEqual([]);
  });
  it('preserves new history on reload and rejects unreadable data instead of replacing it', () => {
    const data = [saveCheckIn(area(), { status: 'behind', reason: 'Exam week', next: '' })];
    expect(loadStatusVitals(store({ [statusVitalsKey(true)]: JSON.stringify(data) }), true)).toEqual(data);
    expect(() => loadStatusVitals(store({ [statusVitalsKey(true)]: 'bad json' }), true)).toThrow();
    expect(() => loadStatusVitals(store({ [simpleVitalsKey(true)]: '[{}]' }), true)).toThrow();
  });
});
