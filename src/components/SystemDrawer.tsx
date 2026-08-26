/**
 * The system side panel.
 *
 * A system is three things and no more: what you do, how often you do it, and
 * the goal it serves (if any). Everything else a system could carry belongs on
 * the tasks themselves or nowhere.
 *
 * The actions list edits as a form rather than writing through on every
 * keystroke: rows are held locally and committed on save, so backing out of a
 * half-typed action leaves nothing behind. That also lets a brand-new system
 * gather its actions before it exists.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuestStore, systemGoalIds, systemQuestIds, routineSystemIds } from '../store';
import { cleanQuest } from '../lib/ui';
import { systemRoutines } from '../lib/systems';
import type { RecurringType } from '../types';
import Field from './Field';
import MultiSelect from './MultiSelect';
import IconPicker from './IconPicker';

/** Null id = creating. A string = editing that system. */
export type SystemTarget = { id: string | null } | null;

/** One row of the actions list. `id` is set for actions that already exist. */
interface DraftAction {
  /** Stable key for React; equals the routine id for existing actions. */
  key: string;
  id?: string;
  title: string;
  recurring: RecurringType | null;
  intervalDays?: number;
}

/** The frequencies a system's actions can run on. `custom` opens a day count. */
const FREQUENCIES: { value: string; label: string }[] = [
  { value: 'daily',   label: 'Every day' },
  { value: 'weekly',  label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom',  label: 'Every N days' },
];

const freqValue = (a: DraftAction) => (a.intervalDays && a.intervalDays > 1 ? 'custom' : a.recurring ?? 'daily');

let seq = 0;
const nextKey = () => `draft-${++seq}`;

function Panel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const systems    = useQuestStore(s => s.systems);
  const questlines = useQuestStore(s => s.questlines);
  const routines   = useQuestStore(s => s.routines);
  const addSystem       = useQuestStore(s => s.addSystem);
  const updateSystem    = useQuestStore(s => s.updateSystem);
  const deleteSystem    = useQuestStore(s => s.deleteSystem);
  const toggleRoutineSystem = useQuestStore(s => s.toggleRoutineSystem);
  const setRoutineRecurring = useQuestStore(s => s.setRoutineRecurring);
  const updateRoutineTitle  = useQuestStore(s => s.updateRoutineTitle);
  const addSystemAction     = useQuestStore(s => s.addSystemAction);

  const existing = id ? systems.find(s => s.id === id) : undefined;
  const members  = existing ? systemRoutines(routines, existing.id) : [];

  const [title, setTitle] = useState(existing?.title ?? '');
  /**
   * What this system serves, as one list.
   *
   * The hierarchy has two levels a system can attach to — a questline is a
   * direction, a quest is a goal inside it — and asking for them in two separate
   * fields made you learn the difference before you could fill in either. One
   * picker, with the quests nested under their questline, keyed so the save can
   * tell them apart again.
   */
  const [served, setServed] = useState<string[]>(existing
    ? [...systemGoalIds(existing).map(id => `ql:${id}`), ...systemQuestIds(existing).map(id => `q:${id}`)]
    : []);

  const serveOptions = questlines.filter(q => !q.hidden).flatMap(ql => [
    { id: `ql:${ql.id}`, label: ql.title },
    ...ql.quests.filter(q => !q.hidden).map(q => ({ id: `q:${q.id}`, label: `↳ ${cleanQuest(q.title)}` })),
  ]);

  const idsOf = (prefix: string) =>
    served.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
  const [icon, setIcon] = useState(existing?.icon ?? '');
  // A new system opens with one empty row: an Actions section showing only two
  // buttons reads as broken, and the first thing to do here is name an action.
  const [actions, setActions] = useState<DraftAction[]>(() =>
    existing
      ? members.map(r => ({ key: r.id, id: r.id, title: r.title, recurring: r.recurring, intervalDays: r.intervalDays }))
      : [{ key: nextKey(), title: '', recurring: 'daily' }]);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  /** Repeating tasks that already exist and aren't in this system's list yet. */
  const available = routines.filter(r =>
    !r.hidden && (r.recurring || r.intervalDays || r.monthlyRule) && !actions.some(a => a.id === r.id));

  const patch = (key: string, up: Partial<DraftAction>) =>
    setActions(list => list.map(a => (a.key === key ? { ...a, ...up } : a)));

  function setFrequency(key: string, value: string) {
    if (value === 'custom') patch(key, { recurring: null, intervalDays: 3 });
    else patch(key, { recurring: value as RecurringType, intervalDays: undefined });
  }

  function save() {
    if (!title.trim() && actions.length === 0) return onClose();

    let sysId: string;
    if (existing) {
      sysId = existing.id;
      updateSystem(existing.id, { title, questlineIds: idsOf('ql:'), questIds: idsOf('q:'), icon });
    } else {
      sysId = addSystem(title || 'New system', {
        questlineIds: idsOf('ql:'), questIds: idsOf('q:'), icon: icon || undefined,
      });
    }

    for (const a of actions) {
      if (!a.title.trim()) continue;
      if (a.id) {
        const before = routines.find(r => r.id === a.id);
        if (before && before.title !== a.title.trim()) updateRoutineTitle(a.id, a.title.trim());
        if (before && (before.recurring !== a.recurring || (before.intervalDays ?? undefined) !== a.intervalDays)) {
          setRoutineRecurring(a.id, a.recurring, a.intervalDays);
        }
        // Added to this system, not moved into it: a task brought in here keeps
        // whatever other systems it was already part of.
        if (before && !routineSystemIds(before).includes(sysId)) toggleRoutineSystem(a.id, sysId);
      } else {
        addSystemAction(sysId, a.title, a.recurring, a.intervalDays);
      }
    }

    // Rows removed from the list leave *this* system; the task itself survives,
    // as does its membership of any other.
    for (const r of members) {
      if (!actions.some(a => a.id === r.id)) toggleRoutineSystem(r.id, sysId);
    }
    onClose();
  }

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        <Field label="System">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              ref={titleRef}
              className="rune-input"
              placeholder="Physical base"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              style={{ fontSize: 14, padding: '9px 12px' }}
            />
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </Field>

        <Field label="Actions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {actions.map(a => (
              <div key={a.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="rune-input"
                  placeholder="Go to the gym"
                  value={a.title}
                  onChange={e => patch(a.key, { title: e.target.value })}
                  style={{ fontSize: 13.5, padding: '8px 11px', flex: 1, minWidth: 0 }}
                />
                <select
                  className="rune-input"
                  value={freqValue(a)}
                  onChange={e => setFrequency(a.key, e.target.value)}
                  aria-label={`How often: ${a.title || 'new action'}`}
                  style={{ fontSize: 12.5, padding: '8px 6px', width: 116, flexShrink: 0 }}
                >
                  {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                {freqValue(a) === 'custom' && (
                  <input
                    className="rune-input"
                    type="number"
                    min={2}
                    value={a.intervalDays ?? 3}
                    onChange={e => patch(a.key, { intervalDays: Math.max(2, parseInt(e.target.value, 10) || 2) })}
                    aria-label="Days between"
                    style={{ fontSize: 12.5, padding: '8px 6px', width: 58, flexShrink: 0 }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setActions(list => list.filter(x => x.key !== a.key))}
                  title="Remove from this system"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, padding: 4, flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setActions(list => [...list, { key: nextKey(), title: '', recurring: 'daily' }])}
            style={{
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', width: 'fit-content',
              padding: '7px 12px', borderRadius: 9, marginTop: 8,
              border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-dim)',
            }}
          >
            ＋ Add action
          </button>

          {available.length > 0 && (
            <select
              className="rune-input"
              value=""
              onChange={e => {
                const r = routines.find(x => x.id === e.target.value);
                if (r) setActions(list => [...list, { key: r.id, id: r.id, title: r.title, recurring: r.recurring, intervalDays: r.intervalDays }]);
              }}
              style={{ fontSize: 12.5, padding: '7px 9px', marginTop: 8 }}
            >
              <option value="">Add existing task</option>
              {available.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          )}
        </Field>

        <Field label="Serves">
          {questlines.filter(q => !q.hidden).length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>No questlines yet.</p>
          ) : (
            <MultiSelect
              options={serveOptions}
              values={served}
              onToggle={key => setServed(ids => (ids.includes(key) ? ids.filter(x => x !== key) : [...ids, key]))}
              placeholder="Nothing yet"
              noun="selected"
            />
          )}
        </Field>

        {existing && (
          <button
            type="button"
            onClick={() => { deleteSystem(existing.id); onClose(); }}
            style={{
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              padding: '9px 13px', borderRadius: 10, width: 'fit-content',
              border: '1px solid var(--card-border)', background: 'transparent', color: 'var(--danger)',
            }}
          >
            Delete system
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--card-border)' }}>
        <button type="button" onClick={save} className="btn-gold" style={{ flex: 1 }}>
          {existing ? 'Save' : 'Create system'}
        </button>
      </div>
    </>
  );
}

export default function SystemDrawer({ target, onClose }: { target: SystemTarget; onClose: () => void }) {
  const open = target !== null;
  // Keep the latest onClose in a ref so the key handler effect doesn't churn.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && target && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'var(--modal-bg)', backdropFilter: 'blur(3px)', zIndex: 50 }}
          />
          <motion.div
            key="panel"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="side-drawer"
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 94vw)', zIndex: 51,
              background: 'var(--card-bg)', borderLeft: '1px solid var(--card-border)',
              boxShadow: '-14px 0 44px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--card-border)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--page-text)' }}>
                {target.id ? 'Edit system' : 'New system'}
              </h2>
              <button
                onClick={onClose}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Keyed so the fields reset between one system and the next. */}
            <Panel key={target.id ?? 'new'} id={target.id} onClose={onClose} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
