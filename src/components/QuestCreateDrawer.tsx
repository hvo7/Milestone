import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Quest } from '../types';
import { useQuestStore, dateKey } from '../store';
import { cleanQuest } from '../lib/ui';
import { MenuSelect } from '../vynuesUi';
import { RepeatPicker, type RepeatValue } from '../recurrence';
import Field from './Field';

/** Sentinel "questline" value for an uncategorized General task. General items are
 *  stored as routines (not real quests) so they share the same pool as the Today
 *  "General" tasks and the All-tab General group. */
const GENERAL_CATEGORY = '__general__';

/**
 * Right-hand slide-in panel for creating a quest. Unlike the per-questline add,
 * this one starts from the Quests tab and lets you pick which questline the new
 * quest attaches to (plus an optional cadence and due date).
 */
export default function QuestCreateDrawer({ open, onClose, initialQuestlineId, editing }: {
  open: boolean; onClose: () => void; initialQuestlineId?: string;
  editing?: { questlineId: string; quest: Quest } | null;
}) {
  const questlines = useQuestStore(s => s.questlines);
  const addQuest    = useQuestStore(s => s.addQuest);
  const addRoutine  = useQuestStore(s => s.addRoutine);
  const updateQuest = useQuestStore(s => s.updateQuest);
  const moveQuest   = useQuestStore(s => s.moveQuest);
  const visible     = questlines.filter(q => !q.hidden);
  const isEdit      = !!editing;

  // In edit mode keep the quest's current questline selectable even if it's hidden.
  const questlineOptions = (() => {
    const opts = visible.map(q => ({ key: q.id, label: q.title }));
    if (editing && !visible.some(q => q.id === editing.questlineId)) {
      const ql = questlines.find(q => q.id === editing.questlineId);
      if (ql) opts.unshift({ key: ql.id, label: ql.title });
    }
    // "General" is a creation-only category — you can't convert an existing quest into one.
    if (!editing) opts.unshift({ key: GENERAL_CATEGORY, label: 'General' });
    return opts;
  })();

  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [questlineId, setQuestlineId] = useState('');
  const [repeat, setRepeat]           = useState<RepeatValue>({ recurring: null });
  const [dueDate, setDueDate]         = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  // Keep the latest onClose in a ref so it doesn't drive the prefill effect. The quest
  // store re-renders this drawer's parent ~every 60s with a fresh onClose identity; if
  // prefill depended on it, it would re-run mid-edit and wipe whatever the user typed.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Prefill the form only on the open transition or when the edit target changes —
  // blank for a new quest, or the quest's current values when editing.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const q = editing.quest;
      setTitle(cleanQuest(q.title));
      setDescription(q.description ?? '');
      setRepeat({ recurring: q.recurring ?? null, intervalDays: q.intervalDays, monthlyRule: q.monthlyRule });
      setDueDate(q.dueDate ?? '');
      setQuestlineId(editing.questlineId);
    } else {
      // One-time items default their due date to today (editable / cleared for recurring).
      setTitle(''); setDescription(''); setRepeat({ recurring: null }); setDueDate(dateKey());
      // General, not the first questline: opened from the page header this has no
      // questline in mind, and filing a stray task under whichever questline
      // happens to sort first is the one guess that's always wrong.
      setQuestlineId(initialQuestlineId || GENERAL_CATEGORY);
    }
    const t = setTimeout(() => titleRef.current?.focus(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuestlineId, editing?.quest.id, editing?.questlineId]);

  // Escape-to-close, registered independently so a changing onClose never resets the form.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const isGeneral = questlineId === GENERAL_CATEGORY;
  const isRepeating = !!repeat.recurring || !!repeat.intervalDays || !!repeat.monthlyRule;
  const canCreate = !!title.trim() && !!questlineId;

  function create() {
    if (!canCreate) return;
    const { recurring, intervalDays, monthlyRule } = repeat;
    // Anything that repeats resets each cycle, so it doesn't carry a one-off due date.
    const due = isRepeating ? null : (dueDate || null);
    if (isGeneral) {
      // A General quest is really an uncategorized task (routine) so it unifies with the
      // Today "General" tasks and shows in the All-tab General group.
      addRoutine(title.trim(), description.trim(), recurring, undefined, intervalDays, undefined, due, undefined, monthlyRule);
    } else if (editing) {
      // Reassign first if the questline changed, then patch the rest of the fields.
      if (editing.questlineId !== questlineId) moveQuest(editing.questlineId, questlineId, editing.quest.id);
      updateQuest(questlineId, editing.quest.id, {
        title: title.trim(),
        description: description.trim(),
        recurring,
        intervalDays,
        monthlyRule: monthlyRule ?? null,
        dueDate: due,
      });
    } else {
      addQuest(questlineId, title.trim(), description.trim(), recurring, due, monthlyRule);
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
              background: 'var(--card-bg)', borderLeft: '1px solid var(--card-border)',
              boxShadow: '-14px 0 44px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--card-border)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--page-text)' }}>{isEdit ? 'Edit quest' : isGeneral ? 'New task' : 'New quest'}</h2>
              <button
                onClick={onClose}
                title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)', lineHeight: 1, padding: 4 }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
              <>
                  <Field label={isGeneral ? 'Task' : 'Quest'}>
                    <input
                      ref={titleRef}
                      className="rune-input"
                      placeholder={isGeneral ? 'e.g. Book dentist appointment' : 'e.g. Learn TypeScript'}
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') create(); }}
                      style={{ fontSize: 14, padding: '9px 12px' }}
                    />
                  </Field>

                  <Field label="Questline">
                    <MenuSelect
                      label="Questline"
                      value={questlineId}
                      onChange={setQuestlineId}
                      options={questlineOptions}
                    />
                  </Field>

                  <Field label={<>Description <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.7 }}>· optional</span></>}>
                    <textarea
                      className="rune-input"
                      placeholder={isGeneral ? 'What is this task about?' : 'What is this quest about?'}
                      rows={2}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      style={{ fontSize: 14, padding: '9px 12px', resize: 'vertical', minHeight: 56 }}
                    />
                  </Field>

                  <Field label="Repeats">
                    <RepeatPicker value={repeat} onChange={setRepeat} />
                  </Field>

                  {!isRepeating && (
                    <Field label={<>Due date <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.7 }}>· defaults to today</span></>}>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={e => setDueDate(e.target.value)}
                        className="rune-input"
                        style={{ fontSize: 14, padding: '9px 12px', cursor: 'pointer' }}
                      />
                    </Field>
                  )}
              </>
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
                style={{ flex: 2, opacity: canCreate ? 1 : 0.4, padding: '10px' }}
              >
                {isEdit ? 'Save changes' : isGeneral ? 'Create task' : 'Create quest'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
