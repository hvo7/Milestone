export type VitalStep = { id: string; title: string; done: boolean };
export type VitalTask = VitalStep & { subtasks: VitalStep[] };
export type VitalPlan = { sequential: boolean; tasks: VitalTask[] };
export type VitalPlans = { catchUp: VitalPlan; maintenance: VitalPlan };
export const emptyPlan = (): VitalPlan => ({ sequential: false, tasks: [] });
export const taskDone = (task: VitalTask) => task.subtasks.length ? task.subtasks.every(s => s.done) : task.done;
export const planProgress = (plan: VitalPlan) => ({ done: plan.tasks.filter(taskDone).length, total: plan.tasks.length });
export function lockedTask(plan: VitalPlan, index: number) {
  return plan.sequential && plan.tasks.slice(0, index).some(t => !taskDone(t));
}
export function togglePlanItem(plan: VitalPlan, taskId: string, stepId?: string): VitalPlan {
  const index = plan.tasks.findIndex(t => t.id === taskId);
  const task = plan.tasks[index];
  if (!task) return plan;
  if (stepId) {
    const subIndex = task.subtasks.findIndex(s => s.id === stepId);
    const step = task.subtasks[subIndex];
    if (!step || (!step.done && (lockedTask(plan, index) || (plan.sequential && task.subtasks.slice(0, subIndex).some(s => !s.done))))) return plan;
    return { ...plan, tasks: plan.tasks.map(t => t.id === taskId ? { ...t, done: false, subtasks: t.subtasks.map(s => s.id === stepId ? { ...s, done: !s.done } : s) } : t) };
  }
  if (task.subtasks.length || (!task.done && lockedTask(plan, index))) return plan;
  return { ...plan, tasks: plan.tasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t) };
}
export const resetPlan = (plan: VitalPlan): VitalPlan => ({ ...plan, tasks: plan.tasks.map(t => ({ ...t, done: false, subtasks: t.subtasks.map(s => ({ ...s, done: false })) })) });
export function validPlans(value: unknown): value is VitalPlans {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const step = (v: unknown): v is VitalStep => obj(v) && typeof v.id === 'string' && !!v.id && typeof v.title === 'string' && !!v.title.trim() && v.title.length <= 200 && typeof v.done === 'boolean';
  const plan = (v: unknown) => {
    if (!obj(v) || typeof v.sequential !== 'boolean' || !Array.isArray(v.tasks) || v.tasks.length > 100) return false;
    const ids = new Set<string>();
    const unique = (s: VitalStep) => { if (ids.has(s.id)) return false; ids.add(s.id); return true; };
    return v.tasks.every(t => {
      const subtasks: unknown = obj(t) ? t.subtasks : undefined;
      return step(t) && unique(t) && Array.isArray(subtasks) && subtasks.length <= 50 && subtasks.every(s => step(s) && unique(s) && !('subtasks' in s));
    });
  };
  return obj(value) && plan(value.catchUp) && plan(value.maintenance);
}
