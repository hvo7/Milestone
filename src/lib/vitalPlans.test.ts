import { describe, expect, it } from 'vitest';
import { emptyPlan, planProgress, resetPlan, taskDone, togglePlanItem, validPlans, type VitalPlan } from './vitalPlans';
import { loadStatusVitals, newStatusVital, saveCheckIn, statusPace, statusVitalsKey, validStatusVitals } from './statusVitals';
const example = (): VitalPlan => ({ sequential: true, tasks: [
  { id: 'one', title: 'Review lecture', done: false, subtasks: [{ id: 'read', title: 'Read notes', done: false }, { id: 'quiz', title: 'Practice', done: false }] },
  { id: 'two', title: 'Submit assignment', done: false, subtasks: [] },
] });
describe('Life Vitals action plans', () => {
  it('enforces sequential tasks and subtasks, and derives parent completion', () => {
    let p = example();
    expect(togglePlanItem(p, 'two')).toBe(p);
    expect(togglePlanItem(p, 'one', 'quiz')).toBe(p);
    expect(togglePlanItem(p, 'one')).toBe(p);
    p = togglePlanItem(p, 'one', 'read');
    expect(taskDone(p.tasks[0])).toBe(false);
    p = togglePlanItem(p, 'one', 'quiz');
    expect(taskDone(p.tasks[0])).toBe(true);
    p = togglePlanItem(p, 'two');
    expect(planProgress(p)).toEqual({ done: 2, total: 2 });
    p = togglePlanItem(p, 'one', 'read');
    expect(planProgress(p)).toEqual({ done: 1, total: 2 });
    expect(togglePlanItem(p, 'two').tasks[1].done).toBe(false);
  });
  it('allows any-order work and resets checks without losing the plan', () => {
    const p = { ...example(), sequential: false };
    const updated = togglePlanItem(togglePlanItem(p, 'two'), 'one', 'quiz');
    expect(updated.tasks[1].done).toBe(true);
    expect(updated.tasks[0].subtasks[1].done).toBe(true);
    expect(resetPlan(updated)).toEqual(p);
    expect(p.tasks[1].done).toBe(false);
  });
  it('preserves both plans through check-ins and reload without changing chosen status', () => {
    const a = saveCheckIn({ ...newStatusVital(), name: 'School', plans: { catchUp: example(), maintenance: emptyPlan() } }, { status: 'behind', reason: '', next: '' });
    const completed = { ...a, plans: { ...a.plans!, catchUp: { sequential: false, tasks: [{ id: 'done', title: 'Done', done: true, subtasks: [] }] } } };
    expect(statusPace(completed)).toBe('behind');
    const onPace = saveCheckIn(completed, { status: 'on-pace', reason: 'Caught up', next: '' });
    expect(onPace.plans).toEqual(completed.plans);
    const storage = { getItem: (key: string) => key === statusVitalsKey(true) ? JSON.stringify([onPace]) : null };
    expect(loadStatusVitals(storage, true)).toEqual([onPace]);
    expect(loadStatusVitals(storage, false)).toEqual([]);
    expect(validStatusVitals([{ ...newStatusVital(), name: 'Legacy area' }])).toBe(true);
  });
  it('rejects malformed, duplicate, excessively nested and oversized data', () => {
    const plans = { catchUp: example(), maintenance: emptyPlan() };
    expect(validPlans(plans)).toBe(true);
    for (const task of [
      { ...example().tasks[0], title: ' ' },
      { ...example().tasks[0], subtasks: [{ id: 'one', title: 'Duplicate ID', done: false }] },
      { ...example().tasks[0], subtasks: [{ id: 'deep', title: 'Third tier', done: false, subtasks: [] }] },
    ]) expect(validPlans({ ...plans, catchUp: { sequential: false, tasks: [task] } })).toBe(false);
    expect(validPlans({ ...plans, maintenance: { sequential: 'yes', tasks: [] } })).toBe(false);
    expect(validStatusVitals([{ ...newStatusVital(), name: 'Bad', plans: null }])).toBe(false);
  });
});
