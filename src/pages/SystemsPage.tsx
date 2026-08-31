/**
 * Systems — the processes you're running, as distinct from the outcomes.
 *
 * The page is deliberately quieter than Quests. There is no completion bar to
 * fill and nothing to finish: a system is either being run or it isn't, and the
 * only number is how reliably you've run it lately. That framing is the feature,
 * so the copy and the colours are chosen to make a stalled system read as
 * information rather than as a telling-off.
 */
import { useState, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuestStore, onToday, systemGoalIds, systemQuestIds, routineSystemIds } from '../store';
import {
  habitHealth, systemHealth, systemRoutines, orderedSystems, missState, systemTrend,
  healthHex,
} from '../lib/systems';
import { categoryColor, cleanQuest } from '../lib/ui';
import QuestIcon from '../components/QuestIcon';
import { RecurrenceBadge } from '../recurrence';
import type { Routine, System } from '../types';
import type { SystemTarget } from '../components/SystemDrawer';
import type { EditTarget } from '../components/TaskEditDrawer';
import NavBar from '../components/NavBar';
import IconButton from '../components/IconButton';
import { lazyChunk } from '../lib/lazyChunk';

const SystemDrawer = lazyChunk(() => import('../components/SystemDrawer'));
const TaskEditDrawer = lazyChunk(() => import('../components/TaskEditDrawer'));

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Direction of travel. Silent when there isn't enough history to mean anything —
 *  an arrow drawn from four days of data is a guess wearing a uniform. */
function TrendArrow({ delta, meaningful }: { delta: number; meaningful: boolean }) {
  if (!meaningful || Math.abs(delta) < 0.08) return null;
  const up = delta > 0;
  return (
    <span
      title={`${up ? 'Up' : 'Down'} ${pct(Math.abs(delta))} against the previous 7 days`}
      style={{ fontSize: 11, fontWeight: 700, color: up ? '#34d399' : '#fb923c', fontVariantNumeric: 'tabular-nums' }}
    >
      {up ? '↑' : '↓'}{pct(Math.abs(delta))}
    </span>
  );
}

/** One habit inside a system: name, consistency, streak, and the miss warning. */
function HabitLine({ r, onRemove, onEdit }: { r: Routine; onRemove: () => void; onEdit: () => void }) {
  const taskHistory = useQuestStore(s => s.taskHistory);
  const toggleRoutineTracked = useQuestStore(s => s.toggleRoutineTracked);
  const [hovered, setHovered] = useState(false);
  const [pinHover, setPinHover] = useState(false);
  const h = habitHealth(r, taskHistory);
  const miss = missState(r, taskHistory);

  // One state, one meaning: is this on Today? Every pin is live — pressing it
  // puts the task on the day's list, pressing again takes it off.
  const pinned = onToday(r);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--card-border)' }}
    >
      <span style={{ fontSize: 13, color: 'var(--page-text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {r.title}
      </span>
      {/* How often it runs — the other half of what an action is. */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <RecurrenceBadge recurring={r.recurring} intervalDays={r.intervalDays} monthlyRule={r.monthlyRule} />
      </span>

      {/* Never miss twice — said on the day after one miss, while it's still a
          nudge rather than a verdict. */}
      {miss === 'at-risk' && (
        <span
          title="Missed yesterday. Missing once is an accident; twice starts a new habit."
          style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', border: '1px solid #fbbf2455', borderRadius: 999, padding: '1px 7px', flexShrink: 0 }}
        >
          don't miss twice
        </span>
      )}
      {(r.streak ?? 0) > 0 && (
        <span style={{ fontSize: 11, fontWeight: 600, color: '#f97316', flexShrink: 0 }}>🔥{r.streak}</span>
      )}

      {h ? (
        <>
          <span style={{ width: 64, height: 5, borderRadius: 3, background: 'var(--input-bg)', flexShrink: 0, overflow: 'hidden' }}>
            <span style={{ display: 'block', width: pct(h.rate), height: '100%', background: healthHex(h.rate), borderRadius: 3 }} />
          </span>
          <span
            title={`${h.done} of about ${h.expected} over ${h.days} days`}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--page-text-dim)', width: 56, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
          >
            {pct(h.rate)}
          </span>
        </>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--page-text-dim)', width: 126, textAlign: 'right', flexShrink: 0 }}>one-off</span>
      )}

      {/* Put it on the day's list — or take it off again. Styled as the same
          kind of object as the pin in the task drawer: a bordered toggle that
          looks pressable at rest, rather than a faded glyph you have to guess at. */}
      <button
        type="button"
        aria-pressed={pinned}
        aria-label={`Show ${r.title} on Today`}
        onClick={() => toggleRoutineTracked(r.id)}
        onMouseEnter={() => setPinHover(true)}
        onMouseLeave={() => setPinHover(false)}
        title={pinned ? 'On Today — click to take it off' : 'Put this on Today'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 24, flexShrink: 0, padding: 0, borderRadius: 8,
          fontFamily: 'inherit', fontSize: 12, lineHeight: 1,
          cursor: 'pointer',
          border: pinned ? '1px solid var(--accent-border)' : '1px solid var(--input-border)',
          background: pinned ? 'var(--accent-soft)' : 'var(--input-bg)',
          // Never below half: at 20% it read as decoration, not a control.
          opacity: pinned ? 1 : pinHover ? 1 : 0.7,
          boxShadow: pinHover ? '0 0 0 3px var(--accent-soft)' : 'none',
          filter: pinned || pinHover ? 'none' : 'grayscale(0.6)',
          transition: 'all 0.15s',
        }}
      >
        📌
      </button>

      {/* Revealed on hover, like every other row in the app: the pencil opens the
          full task drawer — questline, quest, cadence, counter, steps, streak. */}
      <span style={{ display: 'inline-flex', gap: 2, width: 52, flexShrink: 0, justifyContent: 'flex-end' }}>
        {hovered && (
          <>
            <IconButton title="Edit everything — questline, schedule, steps…" onClick={onEdit}>✎</IconButton>
            <IconButton title="Remove from this system" hover="var(--danger)" onClick={onRemove}>✕</IconButton>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * A habit that belongs to no system, as something you can act on.
 *
 * It used to be an inert chip: the page told you the habit was running loose and
 * then gave you no way to do anything about it, which is a list of complaints
 * rather than a page. Clicking it files the habit — into as many systems as you
 * like, since membership isn't exclusive — or opens it for a full edit.
 */
function LooseHabit({ r, systems, onEdit }: { r: Routine; systems: System[]; onEdit: () => void }) {
  const toggleRoutineSystem = useQuestStore(s => s.toggleRoutineSystem);
  const [open, setOpen] = useState(false);
  // Which way it opens is decided when it opens, from where the chip actually is.
  // These chips sit at the very bottom of the page, so downward is usually into
  // space that doesn't exist.
  const [up, setUp] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (!open) {
      const box = chip.current?.getBoundingClientRect();
      const menu = Math.min(280, systems.length * 31 + 44);
      setUp(!!box && box.bottom + menu > window.innerHeight && box.top > menu);
    }
    setOpen(o => !o);
  }

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={chip}
        type="button"
        onClick={toggle}
        title={`Put ${r.title} in a system`}
        style={{
          fontFamily: 'inherit', fontSize: 11, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
          border: '1px solid var(--card-border)', background: 'var(--input-bg)', color: 'var(--page-text)',
        }}
      >
        {r.title} <span aria-hidden="true" style={{ color: 'var(--text-dim)' }}>＋</span>
      </button>

      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <span
            style={{
              position: 'absolute', left: 0, zIndex: 41,
              ...(up ? { bottom: '100%', marginBottom: 5 } : { top: '100%', marginTop: 5 }),
              minWidth: 190, display: 'block', padding: 5, borderRadius: 10,
              background: 'var(--card-bg-raised)', border: '1px solid var(--card-border)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.34)',
            }}
          >
            {systems.map(sys => (
              <button
                key={sys.id}
                type="button"
                onClick={() => { toggleRoutineSystem(r.id, sys.id); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit',
                  fontSize: 12.5, cursor: 'pointer', padding: '6px 9px', borderRadius: 7,
                  border: 'none', background: 'transparent', color: 'var(--page-text)',
                }}
              >
                {sys.title}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setOpen(false); onEdit(); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit',
                fontSize: 12.5, cursor: 'pointer', padding: '6px 9px', borderRadius: 7,
                border: 'none', background: 'transparent', color: 'var(--text-dim)',
                borderTop: systems.length ? '1px solid var(--card-border)' : 'none', marginTop: systems.length ? 3 : 0,
              }}
            >
              Edit task…
            </button>
          </span>
        </>
      )}
    </span>
  );
}

function SystemCard({ system, onEdit, onEditTask }: { system: System; onEdit: () => void; onEditTask: (rId: string) => void }) {
  const routines    = useQuestStore(s => s.routines);
  const questlines  = useQuestStore(s => s.questlines);
  const taskHistory = useQuestStore(s => s.taskHistory);
  const toggleRoutineSystem = useQuestStore(s => s.toggleRoutineSystem);

  const members = systemRoutines(routines, system.id);
  const health  = systemHealth(members, taskHistory);
  const trend   = systemTrend(members, taskHistory);
  const goals   = systemGoalIds(system)
    .map(id => questlines.find(q => q.id === id))
    .filter((q): q is NonNullable<typeof q> => !!q);
  // The finer attachment: individual quests inside a questline. Named the same
  // way, since from here "what does this feed" is one question.
  const quests  = systemQuestIds(system)
    .map(id => questlines.flatMap(ql => ql.quests).find(q => q.id === id))
    .filter((q): q is NonNullable<typeof q> => !!q);
  // A system takes its accent from the first goal it serves, or the app accent
  // when it serves none — one less thing to decide when making one.
  const accent  = goals.length ? categoryColor(goals[0].color) : 'var(--accent)';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22 }}
      className="parchment"
      style={{ borderRadius: 14, padding: '18px 20px', marginBottom: 16, borderLeft: `3px solid ${accent}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <QuestIcon icon={system.icon || '⚙️'} size={17} />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--page-text)', flex: 1 }}>
          {system.title}
        </h2>
        {trend && <TrendArrow delta={trend.delta} meaningful={trend.meaningful} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: healthHex(health.rate), fontVariantNumeric: 'tabular-nums' }}>
          {health.rate == null ? '—' : pct(health.rate)}
        </span>
        <IconButton title="Edit this system" onClick={onEdit}>✎</IconButton>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--page-text-dim)' }}>
          {members.length} habit{members.length === 1 ? '' : 's'}
        </span>
        {goals.map(g => (
          <span key={g.id} style={{ fontSize: 11, color: 'var(--page-text-dim)', border: '1px solid var(--card-border)', borderRadius: 999, padding: '1px 9px' }}>
            serves {g.title}
          </span>
        ))}
        {quests.map(q => (
          <span key={q.id} style={{ fontSize: 11, color: 'var(--page-text-dim)', border: '1px solid var(--card-border)', borderRadius: 999, padding: '1px 9px' }}>
            serves {cleanQuest(q.title)}
          </span>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {members.map(r => (
          <HabitLine key={r.id} r={r} onRemove={() => toggleRoutineSystem(r.id, system.id)} onEdit={() => onEditTask(r.id)} />
        ))}
      </AnimatePresence>

      {members.length === 0 && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--page-text-dim)' }}>No habits yet.</p>
      )}
    </motion.div>
  );
}

export default function SystemsPage() {
  const systems     = useQuestStore(s => s.systems);
  const routines    = useQuestStore(s => s.routines);
  const taskHistory = useQuestStore(s => s.taskHistory);

  const [target, setTarget] = useState<SystemTarget>(null);
  const [taskTarget, setTaskTarget] = useState<EditTarget | null>(null);

  const list  = orderedSystems(systems);
  const loose = routines.filter(r => !routineSystemIds(r).length && !r.hidden && (r.recurring || r.intervalDays || r.monthlyRule));
  // Counted once each, however many systems they're in — the overall score is
  // about the habits you're running, not about how they're filed.
  const assigned = routines.filter(r => routineSystemIds(r).length > 0 && !r.hidden);
  const overall  = systemHealth(assigned, taskHistory);
  const trend    = systemTrend(assigned, taskHistory);

  // Habits one miss from breaking, across every system — the one thing on this
  // page worth acting on right now rather than reading.
  const atRisk = assigned.filter(r => missState(r, taskHistory) === 'at-risk');

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 80 }}>
      <NavBar />

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <h1 className="page-title" style={{ margin: 0 }}>Systems</h1>
          {overall.rate != null && (
            <span style={{ fontSize: 13, fontWeight: 700, color: healthHex(overall.rate), fontVariantNumeric: 'tabular-nums' }}>
              {pct(overall.rate)}
            </span>
          )}
          {trend && <TrendArrow delta={trend.delta} meaningful={trend.meaningful} />}
          <button
            type="button"
            onClick={() => setTarget({ id: null })}
            className="rune-input"
            style={{ marginLeft: 'auto', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 12px', width: 'auto' }}
          >
            ＋ New system
          </button>
        </div>

        {atRisk.length > 0 && (
          <div
            className="parchment"
            style={{ borderRadius: 12, padding: '12px 16px', marginBottom: 16, borderLeft: '3px solid #fbbf24' }}
          >
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--page-text)', lineHeight: 1.5 }}>
              <strong style={{ color: '#fbbf24' }}>Don't miss twice.</strong>{' '}
              {atRisk.map(r => r.title).join(', ')} {atRisk.length === 1 ? 'was' : 'were'} missed yesterday.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {list.map(sys => (
            <SystemCard
              key={sys.id}
              system={sys}
              onEdit={() => setTarget({ id: sys.id })}
              onEditTask={rId => setTaskTarget({ kind: 'routine', id: rId })}
            />
          ))}
        </AnimatePresence>

        {list.length === 0 && (
          <div className="parchment" style={{ borderRadius: 14, padding: '22px 20px', marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--page-text-dim)' }}>No systems yet.</p>
          </div>
        )}

        {loose.length > 0 && (
          <div
            className="parchment"
            // overflow visible, against .parchment's clip: the chips here open a
            // menu, and a card that crops its own popover hides the only control
            // in the box.
            style={{ borderRadius: 14, padding: '16px 20px', opacity: 0.9, overflow: 'visible' }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: 'var(--page-text)' }}>
              Not in a system
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {loose.map(r => (
                <LooseHabit key={r.id} r={r} systems={list} onEdit={() => setTaskTarget({ kind: 'routine', id: r.id })} />
              ))}
            </div>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <SystemDrawer target={target} onClose={() => setTarget(null)} />
        <TaskEditDrawer target={taskTarget} onClose={() => setTaskTarget(null)} />
      </Suspense>
    </div>
  );
}
