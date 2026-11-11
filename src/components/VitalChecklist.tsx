import { useState, type FormEvent } from 'react';
import { emptyPlan, lockedTask, planProgress, resetPlan, taskDone, togglePlanItem, type VitalPlan, type VitalPlans } from '../lib/vitalPlans';
import { statusPace, type StatusVital } from '../lib/statusVitals';

export default function VitalChecklist({ area, onSave }: { area: StatusVital; onSave: (area: StatusVital) => boolean }) {
  const [kind, setKind] = useState<keyof VitalPlans>(statusPace(area) === 'behind' ? 'catchUp' : 'maintenance');
  const [editor, setEditor] = useState<{ taskId?: string; stepId?: string; addSub?: boolean; title: string } | null>(null);
  const [confirm, setConfirm] = useState<{ taskId?: string; stepId?: string } | null>(null);
  const [error, setError] = useState('');
  const plans = area.plans ?? { catchUp: emptyPlan(), maintenance: emptyPlan() };
  const plan = plans[kind];
  const progress = planProgress(plan);
  const hasChecks = plan.tasks.some(t => t.done || t.subtasks.some(s => s.done));
  const commit = (next: VitalPlan) => {
    if (!onSave({ ...area, plans: { ...plans, [kind]: next } })) { setError('Could not save checklist. Try again.'); return false; }
    setError(''); return true;
  };
  const saveTitle = (event: FormEvent) => {
    event.preventDefault();
    if (!editor || !editor.title.trim()) return;
    const title = editor.title.trim();
    let tasks = plan.tasks;
    if (!editor.taskId) tasks = [...tasks, { id: crypto.randomUUID(), title, done: false, subtasks: [] }];
    else tasks = tasks.map(t => t.id !== editor.taskId ? t : editor.addSub
      ? { ...t, done: false, subtasks: [...t.subtasks, { id: crypto.randomUUID(), title, done: false }] }
      : editor.stepId ? { ...t, subtasks: t.subtasks.map(s => s.id === editor.stepId ? { ...s, title } : s) } : { ...t, title });
    if (commit({ ...plan, tasks })) setEditor(null);
  };
  const removeOrReset = () => {
    if (!confirm) return;
    const next = !confirm.taskId ? resetPlan(plan) : { ...plan, tasks: confirm.stepId
      ? plan.tasks.map(t => t.id === confirm.taskId ? { ...t, done: taskDone(t), subtasks: t.subtasks.filter(s => s.id !== confirm.stepId) } : t)
      : plan.tasks.filter(t => t.id !== confirm.taskId) };
    if (commit(next)) setConfirm(null);
  };
  const move = (index: number, direction: number) => {
    const tasks = [...plan.tasks];
    [tasks[index], tasks[index + direction]] = [tasks[index + direction], tasks[index]];
    commit({ ...plan, tasks });
  };
  const moveSubtask = (taskId: string, index: number, direction: number) => {
    commit({ ...plan, tasks: plan.tasks.map(t => {
      if (t.id !== taskId) return t;
      const subtasks = [...t.subtasks];
      [subtasks[index], subtasks[index + direction]] = [subtasks[index + direction], subtasks[index]];
      return { ...t, subtasks };
    }) });
  };
  return <section className="lv-checklist" aria-label="Action checklists">
    <div className="lv-plan-tabs" aria-label="Checklist type">{(['catchUp', 'maintenance'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} disabled={!!editor || !!confirm} onClick={() => { setKind(value); setError(''); }}>{value === 'catchUp' ? 'Catch-up' : 'Maintenance'}</button>)}</div>
    <div className="lv-plan-heading"><h3>{kind === 'catchUp' ? 'Get back on pace' : 'Keep on pace'}</h3><span>{progress.done}/{progress.total} tasks</span></div>
    {plan.tasks.length > 0 && <label className="lv-plan-order">Order<select aria-label="Checklist order" value={plan.sequential ? 'sequential' : 'any'} onChange={e => commit({ ...plan, sequential: e.target.value === 'sequential' })}><option value="any">Any order</option><option value="sequential">Sequential</option></select></label>}
    <ol className="lv-plan-tasks">{plan.tasks.map((task, index) => {
      const locked = lockedTask(plan, index);
      const done = taskDone(task);
      return <li key={task.id}>
        <div className="lv-plan-row"><input type="checkbox" aria-label={`Complete ${task.title}`} title={task.subtasks.length ? 'Completed when all subtasks are checked' : undefined} checked={done} disabled={!!task.subtasks.length || (locked && !done)} onChange={() => commit(togglePlanItem(plan, task.id))} /><span className={done ? 'lv-plan-done' : ''}>{task.title}</span>{locked && !done && <span className="lv-plan-lock">Waiting</span>}</div>
        <div className="lv-plan-tools">
          <button type="button" disabled={!!editor || task.subtasks.length >= 50} onClick={() => setEditor({ taskId: task.id, addSub: true, title: '' })}>+ Subtask</button>
          <button type="button" disabled={!!editor} aria-label={`Edit ${task.title}`} onClick={() => setEditor({ taskId: task.id, title: task.title })}>Edit</button>
          <button type="button" aria-label={`Move ${task.title} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`Move ${task.title} down`} disabled={index === plan.tasks.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" aria-label={`Delete ${task.title}`} onClick={() => setConfirm({ taskId: task.id })}>Delete</button>
        </div>
        {!!task.subtasks.length && <ol className="lv-plan-subtasks">{task.subtasks.map((step, subIndex) => <li key={step.id}>
          <div className="lv-plan-row"><input type="checkbox" aria-label={`Complete ${step.title}`} checked={step.done} disabled={!step.done && (locked || (plan.sequential && task.subtasks.slice(0, subIndex).some(s => !s.done)))} onChange={() => commit(togglePlanItem(plan, task.id, step.id))} /><span className={step.done ? 'lv-plan-done' : ''}>{step.title}</span></div>
          <div className="lv-plan-tools"><button type="button" disabled={!!editor} aria-label={`Edit ${step.title}`} onClick={() => setEditor({ taskId: task.id, stepId: step.id, title: step.title })}>Edit</button><button type="button" aria-label={`Move ${step.title} up`} disabled={subIndex === 0} onClick={() => moveSubtask(task.id, subIndex, -1)}>↑</button><button type="button" aria-label={`Move ${step.title} down`} disabled={subIndex === task.subtasks.length - 1} onClick={() => moveSubtask(task.id, subIndex, 1)}>↓</button><button type="button" aria-label={`Delete ${step.title}`} onClick={() => setConfirm({ taskId: task.id, stepId: step.id })}>Delete</button></div>
        </li>)}</ol>}
      </li>;
    })}</ol>
    {editor ? <form className="lv-plan-editor" onSubmit={saveTitle}><label>{editor.addSub || editor.stepId ? 'Subtask' : 'Task'}<input autoFocus required maxLength={200} value={editor.title} onChange={e => setEditor({ ...editor, title: e.target.value })} /></label><button type="submit" className="lv-primary">Save item</button><button type="button" className="lv-secondary" onClick={() => { setEditor(null); setError(''); }}>Cancel</button></form>
      : <button type="button" className="lv-secondary" disabled={plan.tasks.length >= 100} onClick={() => setEditor({ title: '' })}>+ Add task</button>}
    {kind === 'maintenance' && hasChecks && !confirm && <button type="button" className="lv-text-button" onClick={() => setConfirm({})}>Reset checks</button>}
    {confirm && <div className="lv-plan-confirm" role="group" aria-label="Confirm checklist change"><p>{confirm.taskId ? (confirm.stepId ? 'Delete this subtask?' : 'Delete this task and its subtasks?') : 'Uncheck all maintenance tasks and subtasks?'}</p><button type="button" className="lv-secondary" onClick={removeOrReset}>Confirm</button><button type="button" className="lv-text-button" onClick={() => setConfirm(null)}>Cancel</button></div>}
    {progress.total > 0 && progress.done === progress.total && <p className="lv-plan-finished">Checklist complete. Review your status below.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
