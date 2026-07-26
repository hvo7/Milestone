import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuestStore, dateKey } from '../store';
import { useVynuesStore, type TaskPriority } from '../vynuesStore';
import { RepeatPicker, type RepeatValue } from '../recurrence';
import { MenuSelect, PrioritySegmented, PROJECT_COLOR_VAR, toDateTimeLocalInput } from '../vynuesUi';
import SubtaskTree from './SubtaskTree';
import Field from './Field';
import { cleanQuest, routineSubNodes, vynuesSubNodes } from '../lib/ui';

/** Which task the drawer is editing. One drawer covers all three stores. */
export type EditTarget =
  | { kind: 'routine'; id: string }
  | { kind: 'vynues'; projectId: string; taskId: string }
  | { kind: 'action'; qlId: string; qId: string; aId: string };

const ANCHOR_KEY = '__anchor__';

// ── Routine editor ────────────────────────────────────────────────────────────

function RoutineEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const routine     = useQuestStore(s => s.routines.find(r => r.id === id));
  const questlines  = useQuestStore(s => s.questlines);
  const updateRoutine        = useQuestStore(s => s.updateRoutine);
  const deleteRoutine        = useQuestStore(s => s.deleteRoutine);
  const toggleRoutineTracked = useQuestStore(s => s.toggleRoutineTracked);
  const addRoutineSubtask    = useQuestStore(s => s.addRoutineSubtask);
  const toggleRoutineSubtask = useQuestStore(s => s.toggleRoutineSubtask);
  const renameRoutineSubtask = useQuestStore(s => s.renameRoutineSubtask);
  const deleteRoutineSubtask = useQuestStore(s => s.deleteRoutineSubtask);

  const [title, setTitle]     = useState(routine?.title ?? '');
  const [desc, setDesc]       = useState(routine?.description ?? '');
  const [category, setCategory] = useState(routine?.anchor ? ANCHOR_KEY : (routine?.questlineId ?? ''));
  const [questId, setQuestId] = useState(routine?.questId ?? '');
  const [repeat, setRepeat]   = useState<RepeatValue>({ recurring: routine?.recurring ?? null, intervalDays: routine?.intervalDays, monthlyRule: routine?.monthlyRule });
  const [dueDate, setDueDate] = useState(routine?.dueDate ?? '');
  const [counterOn, setCounterOn] = useState(routine?.target != null);
  const [target, setTarget]   = useState(String(routine?.target ?? 3));
  const [step, setStep]       = useState(String(routine?.step ?? 1));
  const [unit, setUnit]       = useState(routine?.unit ?? '');

  if (!routine) return null;

  const ql = questlines.find(q => q.id === category);
  const isRepeating = !!repeat.recurring || !!repeat.intervalDays || !!repeat.monthlyRule;
  const canPin = (routine.recurring && routine.recurring !== 'daily') || !!routine.intervalDays || !!routine.monthlyRule;

  function save() {
    if (!routine) return;
    const goal = parseInt(target, 10);
    const per  = parseInt(step, 10);
    updateRoutine(routine.id, {
      title: title.trim() || routine.title,
      description: desc.trim(),
      questlineId: category && category !== ANCHOR_KEY ? category : null,
      questId: category && category !== ANCHOR_KEY && questId ? questId : null,
      anchor: category === ANCHOR_KEY,
      recurring: repeat.recurring,
      intervalDays: repeat.intervalDays,
      monthlyRule: repeat.monthlyRule,
      dueDate: isRepeating ? null : (dueDate || null),
      counter: counterOn && goal > 0
        ? { target: goal, step: per > 1 ? per : undefined, unit: unit.trim() || undefined }
        : null,
    });
    onClose();
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Task">
          <input
            className="rune-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            style={{ fontSize: 14, padding: '9px 12px' }}
          />
        </Field>

        <Field label="Description">
          <textarea
            className="rune-input"
            placeholder="Any details… (optional)"
            rows={2}
            value={desc}
            onChange={e => setDesc(e.target.value)}
            style={{ fontSize: 14, padding: '9px 12px', resize: 'vertical', minHeight: 56 }}
          />
        </Field>

        <Field label="Category">
          <MenuSelect
            label="Category"
            value={category}
            onChange={v => { setCategory(v); setQuestId(''); }}
            options={[
              { key: '', label: 'General' },
              { key: ANCHOR_KEY, label: '🛠️ Fixing my Chud life' },
              ...questlines.filter(q => !q.hidden).map(q => ({ key: q.id, label: q.title })),
            ]}
          />
        </Field>

        {ql && ql.quests.filter(q => !q.hidden).length > 0 && (
          <Field label="Quest (optional)">
            <MenuSelect
              label="Quest"
              value={questId}
              onChange={setQuestId}
              options={[{ key: '', label: 'Whole questline' }, ...ql.quests.filter(q => !q.hidden).map(q => ({ key: q.id, label: cleanQuest(q.title) }))]}
            />
          </Field>
        )}

        <Field
          label="Repeats"
          hint={repeat.monthlyRule
            ? 'Lands on exactly that date each month — it shows on Today when the day arrives.'
            : repeat.recurring === 'weekly' || repeat.recurring === 'monthly' || (repeat.intervalDays ?? 0) > 1
              ? 'Multi-day goals with a counter or steps show on Today every day — knock out a bit whenever, skip a day without losing the week.'
              : undefined}
        >
          <RepeatPicker value={repeat} onChange={setRepeat} />
        </Field>

        {!isRepeating && (
          <Field label="Due date">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="date"
                value={dueDate ?? ''}
                onChange={e => setDueDate(e.target.value)}
                className="rune-input"
                style={{ flex: 1, fontSize: 14, padding: '9px 12px', cursor: 'pointer' }}
              />
              {dueDate && (
                <button className="btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} onClick={() => setDueDate('')}>
                  Clear
                </button>
              )}
              <button className="btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} onClick={() => setDueDate(dateKey())}>
                Today
              </button>
            </div>
          </Field>
        )}

        <Field label="Goal">
          {!counterOn ? (
            <button
              type="button"
              onClick={() => setCounterOn(true)}
              className="btn-ghost"
              style={{ width: 'fit-content', fontSize: 13, padding: '8px 13px' }}
            >
              # Track as a counter
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--page-text-dim)' }}>Reach</span>
                <input type="number" min={1} className="rune-input" value={target} onChange={e => setTarget(e.target.value)}
                  style={{ width: 64, fontSize: 14, padding: '8px 10px', textAlign: 'center' }} />
                <input className="rune-input" placeholder="unit (e.g. oz)" value={unit} onChange={e => setUnit(e.target.value)}
                  style={{ flex: '1 1 90px', minWidth: 80, fontSize: 14, padding: '8px 10px' }} />
                <button type="button" onClick={() => setCounterOn(false)} title="Remove counter"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}>
                  ✕
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--page-text-dim)' }}>Each ＋ tap adds</span>
                <input type="number" min={1} className="rune-input" value={step} onChange={e => setStep(e.target.value)}
                  style={{ width: 64, fontSize: 14, padding: '8px 10px', textAlign: 'center' }} />
              </div>
            </div>
          )}
        </Field>

        {canPin && (
          <Field label="Today" hint="Non-daily tasks without a counter or steps stay off Today until their due day — pin to work on it today anyway.">
            <button
              type="button"
              onClick={() => toggleRoutineTracked(routine.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, width: 'fit-content',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                padding: '8px 13px', borderRadius: 10,
                border: routine.trackedToday ? '1px solid var(--accent-border)' : '1px solid var(--input-border)',
                background: routine.trackedToday ? 'var(--accent-soft)' : 'var(--input-bg)',
                color: routine.trackedToday ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'all 0.15s',
              }}
            >
              📌 {routine.trackedToday ? 'Pinned to Today' : 'Pin to Today'}
            </button>
          </Field>
        )}

        <Field label="Steps" hint="Every step can be broken down again with its own ＋ — as deep as it takes.">
          <SubtaskTree
            nodes={routineSubNodes(routine.subtasks)}
            showRootAdd
            handlers={{
              onToggle: sId => toggleRoutineSubtask(routine.id, sId),
              onAdd: (t, parentId) => addRoutineSubtask(routine.id, t, parentId),
              onRename: (sId, t) => renameRoutineSubtask(routine.id, sId, t),
              onDelete: sId => deleteRoutineSubtask(routine.id, sId),
            }}
          />
        </Field>

        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <button
            className="btn-ghost"
            onClick={() => { deleteRoutine(routine.id); onClose(); }}
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 12.5, padding: '8px 14px', opacity: 0.85 }}
          >
            Delete task
          </button>
        </div>
      </div>

      <div style={{ padding: '16px 22px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 10 }}>
        <button onClick={onClose} className="btn-ghost" style={{ flex: 1, padding: '10px', borderRadius: 10 }}>
          Cancel
        </button>
        <button className="btn-gold" onClick={save} style={{ flex: 2, padding: '10px' }}>
          Save changes
        </button>
      </div>
    </>
  );
}

// ── Vynues task editor ────────────────────────────────────────────────────────

function VynuesEditor({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const project = useVynuesStore(s => s.projects.find(p => p.id === projectId));
  const task    = project?.tasks.find(t => t.id === taskId);
  const updateTask    = useVynuesStore(s => s.updateTask);
  const deleteTask    = useVynuesStore(s => s.deleteTask);
  const toggleTracked = useVynuesStore(s => s.toggleTaskTracked);
  const addSubtask    = useVynuesStore(s => s.addSubtask);
  const toggleSubtask = useVynuesStore(s => s.toggleSubtask);
  const renameSubtask = useVynuesStore(s => s.renameSubtask);
  const deleteSubtask = useVynuesStore(s => s.deleteSubtask);

  const [title, setTitle]       = useState(task?.title ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium');
  const [repeat, setRepeat]     = useState<RepeatValue>({ recurring: task?.recurring ?? null, intervalDays: task?.intervalDays, monthlyRule: task?.monthlyRule });
  const [due, setDue]           = useState(toDateTimeLocalInput(task?.dueDate));
  const [notes, setNotes]       = useState(task?.notes ?? '');

  if (!project || !task) return null;
  const accent = PROJECT_COLOR_VAR[project.color];
  const isRepeating = !!repeat.recurring || !!repeat.intervalDays || !!repeat.monthlyRule;
  const canTrack = !!repeat.monthlyRule || (repeat.recurring !== 'daily' && repeat.recurring !== 'weekly');

  function save() {
    if (!task) return;
    updateTask(projectId, taskId, {
      title: title.trim() || task.title,
      priority,
      recurring: repeat.recurring,
      intervalDays: repeat.intervalDays,
      monthlyRule: repeat.monthlyRule ?? null,
      dueDate: isRepeating ? null : (due || null),
      notes: notes.trim() || undefined,
    });
    onClose();
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Task">
          <input
            className="rune-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            style={{ fontSize: 14, padding: '9px 12px' }}
          />
        </Field>

        <Field label="Project">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: accent, marginRight: 7 }} />
            <span style={{ color: 'var(--page-text)', fontWeight: 600 }}>{project.name}</span>
          </p>
        </Field>

        <Field label="Priority">
          <div><PrioritySegmented value={priority} onChange={setPriority} /></div>
        </Field>

        <Field label="Repeats">
          <RepeatPicker value={repeat} onChange={setRepeat} />
        </Field>

        {!isRepeating && (
          <Field label="Due date">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="datetime-local"
                value={due}
                onChange={e => setDue(e.target.value)}
                className="rune-input"
                style={{ flex: 1, fontSize: 14, padding: '9px 12px', cursor: 'pointer' }}
              />
              {due && (
                <button className="btn-ghost" style={{ padding: '8px 12px', fontSize: 12 }} onClick={() => setDue('')}>
                  Clear
                </button>
              )}
            </div>
          </Field>
        )}

        {canTrack && (
          <Field label="Today">
            <button
              type="button"
              onClick={() => toggleTracked(projectId, taskId)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, width: 'fit-content',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                padding: '8px 13px', borderRadius: 10,
                border: task.tracked ? '1px solid var(--accent-border)' : '1px solid var(--input-border)',
                background: task.tracked ? 'var(--accent-soft)' : 'var(--input-bg)',
                color: task.tracked ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'all 0.15s',
              }}
            >
              📌 {task.tracked ? 'Tracked in Today' : 'Track in Today'}
            </button>
          </Field>
        )}

        <Field label="Notes">
          <textarea
            className="rune-input"
            placeholder="Any details… (optional)"
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            style={{ fontSize: 14, padding: '9px 12px', resize: 'vertical', minHeight: 56 }}
          />
        </Field>

        <Field label="Steps" hint="Ticking every step completes the task. Any step can be broken down again.">
          <SubtaskTree
            nodes={vynuesSubNodes(task.subtasks)}
            showRootAdd
            handlers={{
              onToggle: sId => toggleSubtask(projectId, taskId, sId),
              onAdd: (t, parentId) => addSubtask(projectId, taskId, t, parentId),
              onRename: (sId, t) => renameSubtask(projectId, taskId, sId, t),
              onDelete: sId => deleteSubtask(projectId, taskId, sId),
            }}
          />
        </Field>

        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <button
            className="btn-ghost"
            onClick={() => { deleteTask(projectId, taskId); onClose(); }}
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 12.5, padding: '8px 14px', opacity: 0.85 }}
          >
            Delete task
          </button>
        </div>
      </div>

      <div style={{ padding: '16px 22px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 10 }}>
        <button onClick={onClose} className="btn-ghost" style={{ flex: 1, padding: '10px', borderRadius: 10 }}>
          Cancel
        </button>
        <button className="btn-gold" onClick={save} style={{ flex: 2, padding: '10px', background: accent }}>
          Save changes
        </button>
      </div>
    </>
  );
}

// ── Quest-action editor ───────────────────────────────────────────────────────

function ActionEditor({ qlId, qId, aId, onClose }: { qlId: string; qId: string; aId: string; onClose: () => void }) {
  const ql = useQuestStore(s => s.questlines.find(x => x.id === qlId));
  const quest = ql?.quests.find(q => q.id === qId);
  const action = quest?.actions.find(a => a.id === aId);
  const updateActionTitle  = useQuestStore(s => s.updateActionTitle);
  const setActionRecurring = useQuestStore(s => s.setActionRecurring);
  const toggleTracked      = useQuestStore(s => s.toggleTracked);
  const deleteAction       = useQuestStore(s => s.deleteAction);

  const [title, setTitle]   = useState(action?.title ?? '');
  const [repeat, setRepeat] = useState<RepeatValue>({ recurring: action?.recurring ?? null, intervalDays: action?.intervalDays, monthlyRule: action?.monthlyRule });

  if (!ql || !quest || !action) return null;

  function save() {
    if (!action) return;
    if (title.trim() && title.trim() !== action.title) updateActionTitle(qlId, qId, aId, title.trim());
    setActionRecurring(qlId, qId, aId, repeat.recurring, repeat.intervalDays, repeat.monthlyRule);
    onClose();
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Action">
          <input
            className="rune-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); }}
            style={{ fontSize: 14, padding: '9px 12px' }}
          />
        </Field>

        <Field label="Belongs to">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            <span style={{ color: 'var(--page-text)', fontWeight: 600 }}>{ql.title}</span>
            {' · '}{cleanQuest(quest.title)}
          </p>
        </Field>

        <Field label="Repeats">
          <RepeatPicker value={repeat} onChange={setRepeat} />
        </Field>

        <Field label="Today">
          <button
            type="button"
            onClick={() => toggleTracked(qlId, qId, aId)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, width: 'fit-content',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              padding: '8px 13px', borderRadius: 10,
              border: action.trackedToday ? '1px solid var(--accent-border)' : '1px solid var(--input-border)',
              background: action.trackedToday ? 'var(--accent-soft)' : 'var(--input-bg)',
              color: action.trackedToday ? 'var(--accent)' : 'var(--text-dim)',
              transition: 'all 0.15s',
            }}
          >
            📌 {action.trackedToday ? 'Pinned to Today' : 'Pin to Today'}
          </button>
        </Field>

        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <button
            className="btn-ghost"
            onClick={() => { deleteAction(qlId, qId, aId); onClose(); }}
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)', fontSize: 12.5, padding: '8px 14px', opacity: 0.85 }}
          >
            Delete action
          </button>
        </div>
      </div>

      <div style={{ padding: '16px 22px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 10 }}>
        <button onClick={onClose} className="btn-ghost" style={{ flex: 1, padding: '10px', borderRadius: 10 }}>
          Cancel
        </button>
        <button className="btn-gold" onClick={save} style={{ flex: 2, padding: '10px' }}>
          Save changes
        </button>
      </div>
    </>
  );
}

// ── Drawer shell ──────────────────────────────────────────────────────────────

/**
 * Right-hand slide-in panel for editing *everything* about an existing task —
 * name, due date, schedule, category, counter goal, priority/notes (Vynues),
 * and its full nested-step breakdown. Opened from the ✎ pencil on any Today row
 * (and reused by other tabs).
 */
export default function TaskEditDrawer({ target, onClose }: {
  target: EditTarget | null;
  onClose: () => void;
}) {
  const open = !!target;

  // Keep the latest onClose in a ref so the key handler effect doesn't churn.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Remount the editor per task so its local field state always starts fresh.
  const editorKey = useMemo(() => {
    if (!target) return 'none';
    if (target.kind === 'routine') return `r-${target.id}`;
    if (target.kind === 'vynues')  return `v-${target.projectId}-${target.taskId}`;
    return `a-${target.aId}`;
  }, [target]);

  return (
    <AnimatePresence>
      {open && target && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'var(--modal-bg)', backdropFilter: 'blur(3px)', zIndex: 50 }}
          />
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 94vw)', zIndex: 51,
              background: 'var(--card-bg)', borderLeft: '1px solid var(--card-border)',
              boxShadow: '-14px 0 44px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--card-border)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--page-text)' }}>Edit task</h2>
              <button
                onClick={onClose}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            {target.kind === 'routine' && <RoutineEditor key={editorKey} id={target.id} onClose={onClose} />}
            {target.kind === 'vynues'  && <VynuesEditor  key={editorKey} projectId={target.projectId} taskId={target.taskId} onClose={onClose} />}
            {target.kind === 'action'  && <ActionEditor  key={editorKey} qlId={target.qlId} qId={target.qId} aId={target.aId} onClose={onClose} />}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
