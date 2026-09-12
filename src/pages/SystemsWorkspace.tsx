import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuestStore, systemGoalIds, systemQuestIds, repeats } from '../store';
import { orderedSystems, systemHealth, systemRoutines } from '../lib/systems';
import { hasVisibleSystem, isUnlinkedSystem, questlineHref, readQuestlineSelection, routineServesQuestline, selectionParams, systemServesQuestline } from '../lib/questlineNavigation';
import { cleanQuest } from '../lib/ui';
import type { System } from '../types';
import type { SystemTarget } from '../components/SystemDrawer';
import type { EditTarget } from '../components/TaskEditDrawer';
import NavBar from '../components/NavBar';
import QuestlineSidebar from '../components/QuestlineSidebar';
import QuestIcon from '../components/QuestIcon';
import RoutineTaskRow from '../components/RoutineTaskRow';
import { lazyChunk } from '../lib/lazyChunk';
import '../components/questlineWorkspace.css';

const SystemDrawer = lazyChunk(() => import('../components/SystemDrawer'));
const TaskEditDrawer = lazyChunk(() => import('../components/TaskEditDrawer'));
const TaskCreateDrawer = lazyChunk(() => import('../components/TaskCreateDrawer'));

function SystemCard({ system, onEdit, onEditTask, onAddTask, focused }: {
  system: System; onEdit: () => void; onEditTask: (id: string) => void; onAddTask: () => void; focused: boolean;
}) {
  const routines = useQuestStore(s => s.routines);
  const questlines = useQuestStore(s => s.questlines);
  const history = useQuestStore(s => s.taskHistory);
  const unlink = useQuestStore(s => s.toggleRoutineSystem);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) panel.current?.scrollIntoView({ block: 'nearest' }); }, [focused]);
  const members = systemRoutines(routines, system.id);
  const health = systemHealth(members, history);
  const goals = questlines.filter(ql => systemGoalIds(system).includes(ql.id));
  const quests = questlines.flatMap(ql => ql.quests.filter(q => systemQuestIds(system).includes(q.id)).map(q => ({ q, ql })));
  return (
    <section ref={panel} className="parchment questline-section" aria-label={system.title}>
      <div className="questline-section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><QuestIcon icon={system.icon || '⚙️'} size={20} /><h2 style={{ margin: 0, overflowWrap: 'anywhere' }}>{system.title}</h2></div>
        <button type="button" className="btn-ghost" onClick={onEdit} aria-label={`Edit system ${system.title}`}>Edit system</button>
      </div>
      {system.description && <p>{system.description}</p>}
      <div className="practice-links">
        {goals.map(ql => <Link key={ql.id} to={questlineHref('quests', ql.id)}>Supports: {ql.title}</Link>)}
        {quests.map(({ q, ql }) => <Link key={q.id} to={questlineHref('quests', ql.id)}>Supports: {ql.title} → {cleanQuest(q.title)}</Link>)}
        {isUnlinkedSystem(system) && <span className="practice-stat">No questline required</span>}
      </div>
      {members.map(r => <RoutineTaskRow key={r.id} routine={r} onEdit={() => onEditTask(r.id)} onRemove={() => unlink(r.id, system.id)} />)}
      {!members.length && <p>No habits yet. Add a habit or link an existing task in Edit system.</p>}
      <button type="button" className="btn-ghost" onClick={onAddTask}>＋ Add habit</button>
      {health.rate != null && <details className="questline-insights"><summary>Consistency · last 30 days</summary>
        <p>{Math.round(health.rate * 100)}% of expected practice across {members.filter(repeats).length} recurring habits. This measures practice, not quest completion.</p>
      </details>}
    </section>
  );
}

export default function SystemsWorkspace() {
  const systems = useQuestStore(s => s.systems);
  const questlines = useQuestStore(s => s.questlines);
  const routines = useQuestStore(s => s.routines);
  const [params, setParams] = useSearchParams();
  const [target, setTarget] = useState<SystemTarget>(null);
  const [taskTarget, setTaskTarget] = useState<EditTarget | null>(null);
  const [newTask, setNewTask] = useState<{ system: string } | null>(null);
  const visibleQuestlines = questlines.filter(q => !q.hidden);
  const selection = readQuestlineSelection(params, visibleQuestlines, true);
  const selected = selection.kind === 'questline' ? visibleQuestlines.find(q => q.id === selection.id) : undefined;
  const all = orderedSystems(systems);
  const list = all.filter(sys => selected ? systemServesQuestline(sys, selected) : selection.kind === 'general' ? isUnlinkedSystem(sys) : true);
  // Use all visible memberships, not the filtered list: switching goals must not
  // pretend a habit has lost its system. Hidden/orphaned memberships stay accessible.
  const loose = routines.filter(r => !r.hidden && repeats(r) && !hasVisibleSystem(r, systems))
    .filter(r => selected ? routineServesQuestline(r, selected) : selection.kind === 'general' ? !r.questlineId && !r.questId : true);
  return (
    <div className="page-shell" style={{ paddingBottom: 80 }}>
      <NavBar />
      <div className="questline-workspace">
        <QuestlineSidebar questlines={visibleQuestlines} systems={systems} selection={selection} mode="systems" onSelect={next => setParams(selectionParams(next))} />
        <div className="questline-main">
          <div className="questline-toolbar"><div><h2 className="page-title">{selected ? selected.title : selection.kind === 'general' ? 'General systems' : 'Your systems'}</h2>
            <p className="questline-description">{selected ? 'Practices supporting this questline.' : selection.kind === 'general' ? 'Ongoing routines without a linked questline.' : 'Your repeatable practices, connected to their purpose.'}</p></div>
            <button type="button" className="btn-gold" onClick={() => setTarget({ id: null, initialQuestlineId: selected?.id })}>＋ New system</button>
          </div>
          {list.map(sys => <SystemCard key={sys.id} system={sys} focused={params.get('system') === sys.id}
            onEdit={() => setTarget({ id: sys.id })} onEditTask={id => setTaskTarget({ kind: 'routine', id })}
            onAddTask={() => setNewTask({ system: sys.id })} />)}
          {!list.length && <section className="parchment questline-section"><h2>{selected ? 'No supporting systems yet' : 'No systems here yet'}</h2>
            <p>{selected ? 'Create a system here, or link an existing one through Edit system in All systems.' : 'Create a system when a group of habits belongs together.'}</p>
            {selection.kind !== 'all' && <button type="button" className="btn-ghost" onClick={() => setParams(selectionParams({ kind: 'all' }))}>View all systems</button>}
          </section>}
          {loose.length > 0 && <section className="parchment questline-section"><h2>Habits without an active system</h2><p>These tasks are still yours. Edit a task to link it to a system.</p>
            {loose.map(r => <RoutineTaskRow key={r.id} routine={r} onEdit={() => setTaskTarget({ kind: 'routine', id: r.id })} />)}
          </section>}
          {selection.kind === 'general' && <Link className="btn-ghost" to="/quests?view=general">General tasks & commitments →</Link>}
        </div>
      </div>
      <Suspense fallback={null}>
        <SystemDrawer target={target} onClose={() => setTarget(null)} />
        <TaskEditDrawer target={taskTarget} onClose={() => setTaskTarget(null)} />
        {newTask && <TaskCreateDrawer open initialSystem={newTask.system} onClose={() => setNewTask(null)} />}
      </Suspense>
    </div>
  );
}
