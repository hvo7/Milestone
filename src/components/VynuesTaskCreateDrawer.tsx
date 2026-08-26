import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVynuesStore, type TaskPriority } from '../vynuesStore';
import { PrioritySegmented, PROJECT_COLOR_VAR } from '../vynuesUi';
import { RepeatPicker, type RepeatValue } from '../recurrence';
import { dateKey } from '../store';
import Field from './Field';

/** Where a new item should land. `projectId` null = nothing preselected (the drawer
 *  asks); `parentTaskId` set = we're adding a *subtask* under that task. */
export interface VynuesDrawerTarget {
  projectId: string | null;
  parentTaskId?: string | null;
}

/**
 * Right-hand slide-in panel for adding to a Vynues project.
 *
 * It covers two of the three levels of the hierarchy (Project → Task → Subtask):
 *  - open it with a `parentTaskId` and it adds a **subtask** under that task — just a
 *    title, since a subtask inherits its parent's schedule and priority;
 *  - otherwise it adds a **task**, and you can pre-seed its subtasks before creating.
 *
 * `target.projectId` preselects the project (that's what the per-project "＋ Task"
 * buttons pass), but the picker stays editable so a task can be re-homed before it's
 * created. Opened from the page header with no project, it just asks which one.
 */
export default function VynuesTaskCreateDrawer({ open, onClose, target }: {
  open: boolean;
  onClose: () => void;
  target: VynuesDrawerTarget;
}) {
  const projects   = useVynuesStore(s => s.projects);
  const addTask    = useVynuesStore(s => s.addTask);
  const addSubtask = useVynuesStore(s => s.addSubtask);

  const defaultDue = `${dateKey()}T17:00`;
  const [projectId, setProjectId] = useState<string | null>(target.projectId);
  const [title, setTitle]       = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [repeat, setRepeat]     = useState<RepeatValue>({ recurring: null });
  const [due, setDue]           = useState(defaultDue);
  const [notes, setNotes]       = useState('');
  const [tracked, setTracked]   = useState(false);
  const [subs, setSubs]         = useState<string[]>([]);
  const [subDraft, setSubDraft] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const parentTaskId = target.parentTaskId ?? null;
  const isSubtask    = !!parentTaskId;

  // Keep the latest onClose in a ref so the reset effect doesn't depend on it.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Reset the form each time the drawer opens, seeding it from the click context.
  useEffect(() => {
    if (!open) return;
    setProjectId(target.projectId);
    setTitle(''); setPriority('medium'); setRepeat({ recurring: null });
    setDue(defaultDue); setNotes(''); setTracked(false); setSubs([]); setSubDraft('');
    const t = setTimeout(() => titleRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target.projectId, target.parentTaskId]);

  const project    = useMemo(() => projects.find(p => p.id === projectId) ?? null, [projects, projectId]);
  const parentTask = useMemo(
    () => (parentTaskId ? project?.tasks.find(t => t.id === parentTaskId) ?? null : null),
    [project, parentTaskId],
  );
  const accent = project ? PROJECT_COLOR_VAR[project.color] : 'var(--accent)';

  const recurring = repeat.recurring;
  const rule = repeat.monthlyRule ?? null;
  // Daily/weekly tasks flow into Today automatically; pinning is for the rest.
  // A calendar rule lands on its own date, so pinning stays available for it.
  const canTrack = !!rule || (recurring !== 'daily' && recurring !== 'weekly');
  const canCreate = !!title.trim() && !!projectId;

  function addSubDraft() {
    const t = subDraft.trim();
    if (!t) return;
    setSubs(list => [...list, t]);
    setSubDraft('');
  }

  function create() {
    if (!canCreate || !projectId) return;
    if (isSubtask && parentTaskId) {
      addSubtask(projectId, parentTaskId, title.trim());
    } else {
      addTask(
        projectId, title.trim(), priority,
        (recurring || rule) ? null : (due || null),
        recurring, repeat.intervalDays,
        notes, canTrack ? tracked : false,
        // Fold in a subtask still sitting in the input, so it isn't silently lost.
        [...subs, subDraft].map(x => x.trim()).filter(Boolean),
        rule,
      );
    }
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50 }}
          />
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="side-drawer"
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 94vw)', zIndex: 51,
              background: 'var(--card-bg)', borderLeft: `3px solid ${accent}`,
              boxShadow: '-14px 0 44px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--card-border)' }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--page-text)' }}>
                  {isSubtask ? 'New subtask' : 'New task'}
                </h2>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isSubtask && parentTask
                    ? <>under <span style={{ color: 'var(--page-text)', fontWeight: 600 }}>{parentTask.title}</span></>
                    : project
                      ? <>in <span style={{ color: 'var(--page-text)', fontWeight: 600 }}>{project.name}</span></>
                      : 'Pick a project below'}
                </p>
              </div>
              <button
                onClick={onClose}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
              <Field label={isSubtask ? 'Subtask' : 'Task'}>
                <input
                  ref={titleRef}
                  className="rune-input"
                  placeholder={isSubtask ? 'One smaller step…' : 'What needs doing?'}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') create(); }}
                  style={{ fontSize: 14, padding: '9px 12px' }}
                />
              </Field>

              {/* Project — preselected from wherever the drawer was opened, still changeable. */}
              <Field label="Project">
                {projects.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
                    No projects yet — create one first.
                  </p>
                ) : isSubtask ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
                    {project?.name} <span style={{ opacity: 0.7 }}>· inherited from the parent task</span>
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {projects.map(p => {
                      const active = p.id === projectId;
                      const c = PROJECT_COLOR_VAR[p.color];
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProjectId(p.id)}
                          style={{
                            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                            padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap',
                            border: `1px solid ${active ? c : 'var(--input-border)'}`,
                            background: active ? c : 'var(--input-bg)',
                            color: active ? '#fff' : 'var(--text-dim)',
                            transition: 'all 0.15s',
                          }}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>

              {/* A subtask has no schedule of its own — it inherits the parent's. */}
              {!isSubtask && (
                <>
                  <Field label="Priority">
                    <div><PrioritySegmented value={priority} onChange={setPriority} /></div>
                  </Field>

                  <Field label="Repeats">
                    <RepeatPicker value={repeat} onChange={setRepeat} />
                  </Field>

                  {!recurring && !rule && (
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

                  {/* Break the task down now, or leave it and add subtasks later from the row. */}
                  <Field label="Subtasks">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {subs.map((s, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '7px 10px', borderRadius: 8,
                            background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                          }}
                        >
                          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>↳</span>
                          <span style={{ flex: 1, fontSize: 13, color: 'var(--page-text)' }}>{s}</span>
                          <button
                            type="button"
                            onClick={() => setSubs(list => list.filter((_, j) => j !== i))}
                            title="Remove"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1, padding: 0 }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="rune-input"
                          placeholder="Add a step…"
                          value={subDraft}
                          onChange={e => setSubDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); addSubDraft(); }
                          }}
                          style={{ flex: 1, fontSize: 13, padding: '8px 11px' }}
                        />
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={addSubDraft}
                          disabled={!subDraft.trim()}
                          style={{ padding: '8px 14px', fontSize: 13, opacity: subDraft.trim() ? 1 : 0.4 }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </Field>

                  <Field label="Today">
                    {canTrack ? (
                      <button
                        type="button"
                        onClick={() => setTracked(v => !v)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 8, width: 'fit-content',
                          fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          padding: '8px 13px', borderRadius: 8,
                          border: tracked ? '1px solid var(--accent-border)' : '1px solid var(--input-border)',
                          background: tracked ? 'var(--accent-soft)' : 'var(--input-bg)',
                          color: tracked ? 'var(--accent)' : 'var(--text-dim)',
                          transition: 'all 0.15s',
                        }}
                      >
                        📌 {tracked ? 'Tracked in Today' : 'Track in Today'}
                      </button>
                    ) : (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        📌 This {recurring} task shows in the Today tab automatically.
                      </p>
                    )}
                  </Field>

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
                </>
              )}
            </div>

            <div style={{ padding: '16px 22px', borderTop: '1px solid var(--card-border)', display: 'flex', gap: 10 }}>
              <button
                onClick={onClose}
                style={{ flex: 1, background: 'transparent', border: '1px solid var(--card-border)', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '10px', color: 'var(--text-dim)' }}
              >
                Cancel
              </button>
              <button
                className="btn-gold"
                onClick={create}
                disabled={!canCreate}
                style={{ flex: 2, opacity: canCreate ? 1 : 0.4, padding: '10px', background: canCreate ? accent : undefined }}
              >
                {isSubtask ? 'Create subtask' : 'Create task'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
