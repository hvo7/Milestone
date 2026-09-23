import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DEFAULT_SPACES, useQuestStore } from '../store';
import NavBar from '../components/NavBar';
import SpacesModal from '../components/SpacesModal';
import AddModal from '../components/AddModal';
import QuestlineAccordionItem from '../components/QuestlineAccordionItem';
import QuestCreateDrawer from '../components/QuestCreateDrawer';
import SystemDrawer, { type SystemTarget } from '../components/SystemDrawer';
import TaskEditDrawer, { type EditTarget } from '../components/TaskEditDrawer';
import TaskCreateDrawer from '../components/TaskCreateDrawer';
import { SystemCard } from './SystemsWorkspace';
import VynuesPage from './VynuesPage';
import type { Quest } from '../types';

export default function SpacePage() {
  const { spaceId } = useParams();
  return <SpaceContent key={spaceId} spaceId={spaceId ?? ''} />;
}

function SpaceContent({ spaceId }: { spaceId: string }) {
  const spaces = useQuestStore(s => s.spaces ?? DEFAULT_SPACES);
  const space = spaces.find(s => s.id === spaceId);
  const questlines = useQuestStore(s => s.questlines).filter(q => q.spaceId === spaceId && !q.hidden);
  const systems = useQuestStore(s => s.systems).filter(s => s.spaceId === spaceId && !s.hidden);
  const [params, setParams] = useSearchParams();
  const view = params.get('section') ?? (spaceId === 'vynues' ? 'projects' : 'quests');
  const setView = (section: string) => setParams({ section });
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemTarget>(null);
  const [task, setTask] = useState<EditTarget | null>(null);
  const [newTask, setNewTask] = useState<string | null>(null);
  const [quest, setQuest] = useState<{ questlineId: string; quest: Quest } | null>(null);
  if (!space || space.archived) return <div className="page-shell"><NavBar cover={{ title: space?.name ?? 'Space not found', subtitle: 'This tab is not available.' }} /><main style={{ padding: 24 }}><Link to="/">Go to Today</Link> <button className="btn-ghost" onClick={() => setManage(true)}>Manage spaces</button>{manage && <SpacesModal onClose={() => setManage(false)} />}</main></div>;
  return <div className="page-shell" style={{ paddingBottom: 60 }}>
    <NavBar cover={{ title: space.name, subtitle: 'Your goals, practices, and projects in one place.' }} />
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }} aria-label="Space sections">
        {(['quests', 'systems', 'projects'] as const).map(v => <button key={v} className={view === v ? 'btn-gold' : 'btn-ghost'} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'quests' ? 'Questlines & quests' : v === 'systems' ? 'Systems' : 'Projects'}</button>)}
        <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setManage(true)}>Manage spaces</button>
      </div>
      {view === 'quests' && <>
        <button className="btn-gold" onClick={() => setAdding(true)}>＋ New questline</button>
        {!questlines.length && <section className="parchment" style={{ padding: 24, marginTop: 20 }}><h2>What do you want to accomplish?</h2><p>Create your first questline for {space.name}, then add quests and tasks. To bring an existing questline here, choose this space in Edit Questline.</p></section>}
        {questlines.map(ql => <QuestlineAccordionItem key={ql.id} questline={ql} isOpen={open === ql.id} onToggle={() => setOpen(open === ql.id ? null : ql.id)} onEditQuest={(questlineId, quest) => setQuest({ questlineId, quest })} />)}
      </>}
      {view === 'systems' && <>
        <button className="btn-gold" onClick={() => setSystem({ id: null, spaceId })}>＋ New system</button>
        {!systems.length && <section className="parchment" style={{ padding: 24, marginTop: 20 }}><h2>Build a repeatable practice</h2><p>Add a system for {space.name}, or assign an existing one here using its Space field.</p></section>}
        {systems.map(s => <SystemCard key={s.id} system={s} focused={false} onEdit={() => setSystem({ id: s.id })} onEditTask={id => setTask({ kind: 'routine', id })} onAddTask={() => setNewTask(s.id)} />)}
      </>}
    </main>
    {view === 'projects' && <VynuesPage spaceId={spaceId} embedded />}
    {manage && <SpacesModal onClose={() => setManage(false)} />}
    {adding && <AddModal mode={{ type: 'questline', spaceId }} onClose={() => setAdding(false)} />}
    <SystemDrawer target={system} onClose={() => setSystem(null)} />
    <TaskEditDrawer target={task} onClose={() => setTask(null)} />
    {newTask && <TaskCreateDrawer open initialSystem={newTask} onClose={() => setNewTask(null)} />}
    {quest && <QuestCreateDrawer open editing={quest} onClose={() => setQuest(null)} />}
  </div>;
}
