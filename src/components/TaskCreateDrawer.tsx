import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuestStore, dateKey } from '../store';
import { useVynuesStore, vynuesCategoryKey, vynuesProjectId } from '../vynuesStore';
import { RepeatPicker, type RepeatValue } from '../recurrence';
import { MenuSelect } from '../vynuesUi';
import Field from './Field';
import MultiSelect from './MultiSelect';
import { cleanQuest, ANCHOR_LABEL, ANCHOR_ICON, ANCHOR_CATEGORY } from '../lib/ui';

/**
 * Right-hand slide-in panel for creating a task. The same drawer covers both
 * General (uncategorized) tasks and quest-linked ones — pick a questline (and
 * optionally a specific quest) plus a recurrence (defaults to one-time).
 */
export default function TaskCreateDrawer({ open, onClose, initialCategory = '', initialSystem = '' }: { open: boolean; onClose: () => void; initialCategory?: string; initialSystem?: string }) {
  const questlines = useQuestStore(s => s.questlines);
  const systems = useQuestStore(s => s.systems);
  const setRoutineSystems = useQuestStore(s => s.setRoutineSystems);
  const toggleRoutineTracked = useQuestStore(s => s.toggleRoutineTracked);
  const addRoutine = useQuestStore(s => s.addRoutine);
  const addAnchorRoutine = useQuestStore(s => s.addAnchorRoutine);
  const vynuesProjects = useVynuesStore(s => s.projects);
  const addVynuesTask  = useVynuesStore(s => s.addTask);

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [questlineId, setQuestlineId] = useState('');   // '' = General, ANCHOR_CATEGORY = anchor habits
  const [questId, setQuestId]         = useState('');    // '' = whole questline
  const [repeat, setRepeat]           = useState<RepeatValue>({ recurring: null });
  const [dueDate, setDueDate]         = useState('');    // one-time tasks default to today
  const [anchorRepeat, setAnchorRepeat] = useState<'daily' | 'weekly'>('daily');
  // Which systems this task is part of, if any — a habit can be several. These are
  // independent of the category above: the system is the process it belongs to,
  // the category is where it's filed.
  const [systemIds, setSystemIds]     = useState<string[]>([]);
  // Counter mode — the task completes progressively (e.g. "go gym 3×", "drink 64oz").
  const [counterOn, setCounterOn]     = useState(false);
  const [target, setTarget]           = useState('3');
  const [step, setStep]               = useState('1');
  const [unit, setUnit]               = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Keep the latest onClose in a ref so it doesn't drive the reset effect. The quest
  // store re-renders Today ~every 60s with a fresh onClose identity; if the reset
  // depended on it, it would re-fire mid-entry and wipe the user's in-progress input.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Reset the form each time the drawer opens, and focus the title.
  useEffect(() => {
    if (!open) return;
    setTitle(''); setDescription(''); setQuestlineId(initialCategory); setQuestId(''); setRepeat({ recurring: null }); setDueDate(dateKey()); setAnchorRepeat('daily'); setSystemIds(initialSystem ? [initialSystem] : []);
    setCounterOn(false); setTarget('3'); setStep('1'); setUnit('');
    const t = setTimeout(() => titleRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [open, initialCategory, initialSystem]);

  const isAnchor  = questlineId === ANCHOR_CATEGORY;
  const repeats   = !!repeat.recurring || !!repeat.intervalDays || !!repeat.monthlyRule || isAnchor;
  const projectId = vynuesProjectId(questlineId);
  const ql = questlines.find(q => q.id === questlineId);
  const visibleQuestlines = questlines.filter(q => !q.hidden);
  const activeProjects = vynuesProjects.filter(p => p.status === 'active');

  function create() {
    if (!title.trim()) return;
    const goal = parseInt(target, 10);
    const per  = parseInt(step, 10);
    const counter = counterOn && goal > 0
      ? { target: goal, step: per > 1 ? per : undefined, unit: unit.trim() || undefined }
      : undefined;
    let newId: string | undefined;
    if (isAnchor) {
      newId = addAnchorRoutine(title.trim(), anchorRepeat, counter);
    } else if (projectId) {
      // Vynues keeps its own task shape (no counters). A one-off with no due date
      // would never surface on Today, so pin it there instead — it was added from
      // the Today list, so that's plainly where it's wanted.
      const oneOff = !repeat.recurring && !repeat.intervalDays && !repeat.monthlyRule;
      addVynuesTask(
        projectId, title.trim(), 'medium',
        oneOff ? (dueDate || null) : null,
        repeat.recurring, repeat.intervalDays,
        description.trim() || undefined,
        oneOff && !dueDate,
        undefined,
        repeat.monthlyRule,
      );
    } else {
      newId = addRoutine(
        title.trim(), description.trim(), repeat.recurring,
        questlineId || undefined, repeat.intervalDays, questId || undefined,
        (repeat.recurring || repeat.monthlyRule) ? null : (dueDate || null),
        counter,
        repeat.monthlyRule,
      );
    }
    // Vynues tasks live in their own store and have no systems, hence the guard.
    if (newId && systemIds.length) setRoutineSystems(newId, systemIds);
    // A General one-off no longer reaches Today on its due date alone — but this
    // drawer only opens *from* Today, so that is plainly where it's wanted. Same
    // reasoning as the Vynues branch above, which pins for the same reason.
    if (newId && !repeats && !questlineId && !systemIds.length) toggleRoutineTracked(newId);
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
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 94vw)', zIndex: 51,
              background: 'var(--card-bg)', borderLeft: '1px solid var(--card-border)',
              boxShadow: '-14px 0 44px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--card-border)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--page-text)' }}>{isAnchor ? 'New habit' : 'New task'}</h2>
              <button
                onClick={onClose}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
              <Field label="Task">
                <input
                  ref={titleRef}
                  className="rune-input"
                  placeholder="What needs doing?"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') create(); }}
                  style={{ fontSize: 14, padding: '9px 12px' }}
                />
              </Field>

              <Field label="Category">
                <MenuSelect
                  label="Category"
                  value={questlineId}
                  onChange={v => { setQuestlineId(v); setQuestId(''); }}
                  options={[
                    { key: '', label: 'General' },
                    { key: ANCHOR_CATEGORY, label: `${ANCHOR_ICON} ${ANCHOR_LABEL}` },
                    ...visibleQuestlines.map(q => ({ key: q.id, label: q.title })),
                    ...activeProjects.map(p => ({ key: vynuesCategoryKey(p.id), label: `🚩 Vynues · ${p.name}` })),
                  ]}
                />
              </Field>

              {!isAnchor && ql && ql.quests.filter(q => !q.hidden).length > 0 && (
                <Field label="Quest (optional)">
                  <MenuSelect
                    label="Quest"
                    value={questId}
                    onChange={setQuestId}
                    options={[{ key: '', label: 'Whole questline' }, ...ql.quests.filter(q => !q.hidden).map(q => ({ key: q.id, label: cleanQuest(q.title) }))]}
                  />
                </Field>
              )}

              {!isAnchor && (
                <Field label="Description">
                  <textarea
                    className="rune-input"
                    placeholder="Any details… (optional)"
                    rows={2}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    style={{ fontSize: 14, padding: '9px 12px', resize: 'vertical', minHeight: 56 }}
                  />
                </Field>
              )}

              {/* Vynues tasks live in their own store, which has no systems. */}
              {/* Only for something that repeats. A system is made of the things
                  you do frequently; a one-and-done task belongs to a quest. */}
              {systems.length > 0 && !projectId && repeats && (
                <Field label="Systems">
                  <MultiSelect
                    options={systems.filter(sys => !sys.hidden).map(sys => ({ id: sys.id, label: sys.title }))}
                    values={systemIds}
                    onToggle={sid => setSystemIds(ids => (ids.includes(sid) ? ids.filter(x => x !== sid) : [...ids, sid]))}
                    placeholder="No system"
                    noun="systems"
                  />
                </Field>
              )}

              <Field label="Repeats">
                {isAnchor ? (
                  <div style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--input-border)', background: 'var(--input-bg)', width: 'fit-content' }}>
                    {(['daily', 'weekly'] as const).map((u, i) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setAnchorRepeat(u)}
                        style={{
                          fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                          padding: '8px 16px', border: 'none', whiteSpace: 'nowrap',
                          borderLeft: i > 0 ? '1px solid var(--input-border)' : 'none',
                          background: anchorRepeat === u ? 'var(--accent-strong)' : 'transparent',
                          color: anchorRepeat === u ? '#fff' : 'var(--text-dim)',
                          transition: 'background 0.15s, color 0.15s',
                        }}
                      >
                        {u === 'daily' ? 'Daily' : 'Weekly'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <RepeatPicker value={repeat} onChange={setRepeat} />
                )}
              </Field>

              {/* Counters are a routine/habit feature — a Vynues task is a plain checkbox. */}
              {!projectId && (
              <Field label="Goal">
                {!counterOn ? (
                  <button
                    type="button"
                    onClick={() => setCounterOn(true)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, width: 'fit-content',
                      fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      padding: '8px 13px', borderRadius: 8,
                      border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-dim)',
                      transition: 'all 0.15s',
                    }}
                  >
                    # Track as a counter
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: 'var(--page-text-dim)' }}>Reach</span>
                      <input
                        type="number"
                        min={1}
                        className="rune-input"
                        value={target}
                        onChange={e => setTarget(e.target.value)}
                        style={{ width: 64, fontSize: 14, padding: '8px 10px', textAlign: 'center' }}
                      />
                      <input
                        className="rune-input"
                        placeholder="unit (e.g. oz)"
                        value={unit}
                        onChange={e => setUnit(e.target.value)}
                        style={{ flex: '1 1 90px', minWidth: 80, fontSize: 14, padding: '8px 10px' }}
                      />
                      <button
                        type="button"
                        onClick={() => setCounterOn(false)}
                        title="Remove counter"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, color: 'var(--page-text-dim)' }}>Each ＋ tap adds</span>
                      <input
                        type="number"
                        min={1}
                        className="rune-input"
                        value={step}
                        onChange={e => setStep(e.target.value)}
                        style={{ width: 64, fontSize: 14, padding: '8px 10px', textAlign: 'center' }}
                      />
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                      Progress toward the goal instead of a single checkbox — it counts as done once you reach it. E.g. gym 3×, or 64 oz of water with +8 per tap.
                    </p>
                  </div>
                )}
              </Field>
              )}

              {!isAnchor && !repeat.recurring && !repeat.monthlyRule && (
                <Field label="Due date">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="rune-input"
                    style={{ fontSize: 14, padding: '9px 12px', cursor: 'pointer' }}
                  />
                </Field>
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
                disabled={!title.trim()}
                style={{ flex: 2, opacity: title.trim() ? 1 : 0.4, padding: '10px' }}
              >
                {isAnchor ? 'Create habit' : 'Create task'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
