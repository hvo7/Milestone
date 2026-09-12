import type { Routine } from '../types';
import { useQuestStore, logicalDateKey, isMultiDayCycle, engagedOnDay, skipActive, sessionMode, cycleDayKeys, onToday, repeats } from '../store';
import { ANCHOR_LABEL, routineSubNodes, hasCheckpoints } from '../lib/ui';
import { RecurrenceBadge } from '../recurrence';
import TaskRow, { type RowStrip } from './today/TaskRow';
import { DueLabel } from './today/labels';
import { usePhoneLayout } from '../lib/usePhoneLayout';

/** Same completion, counters, sessions and nested steps as Today; no copied data. */
export default function RoutineTaskRow({ routine: r, onEdit, onRemove }: {
  routine: Routine; onEdit: () => void; onRemove?: () => void;
}) {
  const phoneLayout = usePhoneLayout();
  const toggle = useQuestStore(s => s.toggleRoutine);
  const increment = useQuestStore(s => s.incrementRoutine);
  const toggleSession = useQuestStore(s => s.toggleSession);
  const setProgress = useQuestStore(s => s.setRoutineProgress);
  const skip = useQuestStore(s => s.skipRoutine);
  const rename = useQuestStore(s => s.updateRoutineTitle);
  const addStep = useQuestStore(s => s.addRoutineSubtask);
  const toggleStep = useQuestStore(s => s.toggleRoutineSubtask);
  const renameStep = useQuestStore(s => s.renameRoutineSubtask);
  const deleteStep = useQuestStore(s => s.deleteRoutineSubtask);
  const pin = useQuestStore(s => s.toggleRoutineTracked);
  const toggleHidden = useQuestStore(s => s.toggleRoutineHidden);
  const today = logicalDateKey();
  const skipped = skipActive(r, today);
  const pinned = onToday(r);
  const todayDone = !r.completed && isMultiDayCycle(r) && !skipped && engagedOnDay(r, today);
  let strip: RowStrip | undefined;
  if (r.target != null) {
    const days = sessionMode(r) ? cycleDayKeys(r) : null;
    if (days) strip = { kind: 'sessions', days, logged: (r.sessionDays ?? []).filter(d => days.includes(d)), onToggle: day => toggleSession(r.id, day) };
    else if (!sessionMode(r) && hasCheckpoints(r.target, r.step ?? 1)) strip = { kind: 'checkpoints', onSet: value => setProgress(r.id, value) };
  }
  if (r.hidden) return <div className="practice-task practice-task-tools"><span style={{ flex: 1, color: 'var(--page-text-dim)' }}>{r.title} · Hidden</span><button type="button" className="btn-ghost" onClick={() => toggleHidden(r.id)}>Restore task</button></div>;
  return (
    <div className="practice-task">
      <TaskRow compact={phoneLayout} title={r.title} completed={r.completed} todayDone={todayDone} skipped={skipped}
        onSkip={repeats(r) ? () => skip(r.id) : undefined} streak={r.streak} accentHex="var(--accent)"
        sourceLine={<><RecurrenceBadge recurring={r.recurring} intervalDays={r.intervalDays} monthlyRule={r.monthlyRule} />{r.dueDate && !r.completed && <DueLabel dueDate={r.dueDate} todayKey={today} />}</>}
        tag={r.anchor ? { label: ANCHOR_LABEL, color: 'var(--accent)' } : undefined}
        onToggle={() => toggle(r.id)} onRename={title => rename(r.id, title)} onEdit={onEdit}
        target={r.target} progress={r.progress} step={r.step} unit={r.unit} onIncrement={r.target != null ? delta => increment(r.id, delta) : undefined} strip={strip}
        subtasks={routineSubNodes(r.subtasks, false)} subHandlers={{ onAdd: (title, parent) => addStep(r.id, title, parent), onToggle: id => toggleStep(r.id, id), onRename: (id, title) => renameStep(r.id, id, title), onDelete: id => deleteStep(r.id, id) }}
      />
      <div className="practice-task-tools">
        <button type="button" className="btn-ghost" aria-pressed={pinned} onClick={() => pin(r.id)}>{pinned ? 'On Today' : 'Add to Today'}</button>
        <button type="button" className="btn-ghost" onClick={onEdit} aria-label={`Edit ${r.title}`}>Edit</button>
        {onRemove && <button type="button" className="btn-ghost" onClick={onRemove} aria-label={`Unlink ${r.title} from this system`}>Unlink</button>}
      </div>
    </div>
  );
}
