import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import NavBar from '../components/NavBar';
import VynuesProjectModal from '../components/VynuesProjectModal';
import VynuesTaskCreateDrawer, { type VynuesDrawerTarget } from '../components/VynuesTaskCreateDrawer';
import TaskEditDrawer, { type EditTarget } from '../components/TaskEditDrawer';
import SubtaskTree from '../components/SubtaskTree';
import { PRIORITY_META, MenuSelect, PROJECT_COLOR_VAR as COLOR_VAR } from '../vynuesUi';
import { vynuesSubNodes } from '../lib/ui';
import { repeats } from '../store';
import { RecurrenceBadge } from '../recurrence';
import {
  useVynuesStore, projectProgress, taskProgress, getTaskDueInfo,
  type VynuesProject, type VynuesTask, type ProjectStatus,
} from '../vynuesStore';

// ── Style maps ────────────────────────────────────────────────────────────────

const STATUS_META: Record<ProjectStatus, { label: string; color: string; dot: string }> = {
  active: { label: 'Active',  color: 'var(--color-sapphire)', dot: '#38bdf8' },
  paused: { label: 'On hold', color: 'var(--color-amber)',    dot: '#fbbf24' },
  done:   { label: 'Done',    color: 'var(--color-emerald)',  dot: '#34d399' },
};

const URGENCY_COLOR: Record<string, string> = {
  overdue: 'var(--color-crimson)',
  urgent:  'var(--color-amber)',
  soon:    'var(--text-dim)',
  ok:      'var(--text-dim)',
};

type StatusFilter = 'all' | ProjectStatus;
type ProjectSort  = 'priority' | 'due' | 'tasksLeft' | 'progress' | 'name' | 'added';
type DueFilter    = 'any' | 'today' | 'week' | 'overdue';

const SORT_OPTS: { key: ProjectSort; label: string }[] = [
  { key: 'priority',  label: 'Priority' },
  { key: 'due',       label: 'Due soonest' },
  { key: 'tasksLeft', label: 'Most tasks left' },
  { key: 'progress',  label: 'Least progress' },
  { key: 'name',      label: 'Name (A–Z)' },
  { key: 'added',     label: 'Date added' },
];

const DUE_OPTS: { key: DueFilter; label: string }[] = [
  { key: 'any',     label: 'Any time' },
  { key: 'today',   label: 'Due today' },
  { key: 'week',    label: 'This week' },
  { key: 'overdue', label: 'Overdue' },
];

// ── Project-level aggregates ─────────────────────────────────────────────────

const openTasks = (p: VynuesProject) => p.tasks.filter(t => !t.done);

function projectPriorityWeight(p: VynuesProject): number {
  return openTasks(p).reduce((max, t) => Math.max(max, PRIORITY_META[t.priority].weight), 0);
}

/** End of the current logical day — the next 5am boundary. */
function nextReset5am(): number {
  const r = new Date();
  if (r.getHours() >= 5) r.setDate(r.getDate() + 1);
  r.setHours(5, 0, 0, 0);
  return r.getTime();
}

function taskEffectiveDue(t: VynuesTask): number {
  if (t.recurring === 'daily')   return nextReset5am();
  if (t.recurring === 'weekly')  return Date.now() + 7 * 86_400_000;
  if (t.recurring === 'monthly') return Date.now() + 30 * 86_400_000;
  if (t.dueDate) return new Date(t.dueDate).getTime();
  return Infinity;
}

function projectSoonestDue(p: VynuesProject): number {
  return openTasks(p).reduce((min, t) => Math.min(min, taskEffectiveDue(t)), Infinity);
}

function projectProgressPct(p: VynuesProject): number {
  const { done, total } = projectProgress(p);
  return total ? done / total : 1;
}

function matchesDue(p: VynuesProject, filter: DueFilter): boolean {
  if (filter === 'any') return true;
  const soonest = projectSoonestDue(p);
  if (soonest === Infinity) return false;
  if (filter === 'overdue') return soonest < Date.now();
  if (filter === 'today')   return soonest <= nextReset5am();
  return soonest <= Date.now() + 7 * 86_400_000;
}

function sortProjects(list: VynuesProject[], sort: ProjectSort): VynuesProject[] {
  const byName = (a: VynuesProject, b: VynuesProject) => a.name.localeCompare(b.name);
  const arr = [...list];
  switch (sort) {
    case 'priority':
      return arr.sort((a, b) => projectPriorityWeight(b) - projectPriorityWeight(a) || projectSoonestDue(a) - projectSoonestDue(b) || byName(a, b));
    case 'due':
      return arr.sort((a, b) => projectSoonestDue(a) - projectSoonestDue(b) || byName(a, b));
    case 'tasksLeft':
      return arr.sort((a, b) => openTasks(b).length - openTasks(a).length || byName(a, b));
    case 'progress':
      return arr.sort((a, b) => projectProgressPct(a) - projectProgressPct(b) || byName(a, b));
    case 'name':
      return arr.sort(byName);
    case 'added':
      return arr.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  }
}

/** Header stat-strip numbers across every project (time-anchored, so computed
 *  outside render like the other due helpers). */
function computeStats(projects: VynuesProject[]) {
  const allTasks = projects.flatMap(p => p.tasks);
  const now = Date.now();
  const dayEnd = nextReset5am();
  return {
    open:     allTasks.filter(t => !t.done).length,
    dueToday: allTasks.filter(t => !t.done && !t.recurring && t.dueDate && new Date(t.dueDate).getTime() <= dayEnd && new Date(t.dueDate).getTime() >= now).length,
    overdue:  allTasks.filter(t => !t.done && !t.recurring && t.dueDate && new Date(t.dueDate).getTime() < now).length,
    done:     allTasks.filter(t => t.done).length,
  };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function VynuesPage() {
  const projects      = useVynuesStore(s => s.projects);
  const deleteProject = useVynuesStore(s => s.deleteProject);

  const [selectedId, setSelectedId]   = useState<string | null>(projects[0]?.id ?? null);
  const [filter, setFilter]           = useState<StatusFilter>('all');
  const [dueFilter, setDueFilter]     = useState<DueFilter>('any');
  const [sort, setSort]               = useState<ProjectSort>('priority');
  const [adding, setAdding]           = useState(false);
  const [editing, setEditing]         = useState<VynuesProject | null>(null);
  const [editTarget, setEditTarget]   = useState<EditTarget | null>(null);

  // The task drawer (side panel) — untouched behaviour: `target` carries which
  // project the "＋ Add Task" click belonged to.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [target, setTarget] = useState<VynuesDrawerTarget>({ projectId: null });
  const openTaskDrawer = (projectId: string | null, parentTaskId?: string | null) => {
    setTarget({ projectId, parentTaskId: parentTaskId ?? null });
    setDrawerOpen(true);
  };

  const visible = useMemo(
    () => sortProjects(
      projects.filter(p => (filter === 'all' || p.status === filter) && matchesDue(p, dueFilter)),
      sort,
    ),
    [projects, filter, dueFilter, sort],
  );

  const selected =
    visible.find(p => p.id === selectedId) ?? visible[0] ?? null;

  function handleDeleteProject(p: VynuesProject) {
    if (!confirm(`Delete project "${p.name}" and all its tasks? This cannot be undone.`)) return;
    deleteProject(p.id);
    setSelectedId(null);
  }

  const counts = {
    all:    projects.length,
    active: projects.filter(p => p.status === 'active').length,
    paused: projects.filter(p => p.status === 'paused').length,
    done:   projects.filter(p => p.status === 'done').length,
  };

  // Stat strip across every project.
  const stats = useMemo(() => computeStats(projects), [projects]);
  const { open: openCount, dueToday: dueTodayCount, overdue: overdueCount, done: doneCount } = stats;

  return (
    <>
      <div style={{ minHeight: '100vh', paddingBottom: 60 }}>
        <NavBar />

        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 className="page-title" style={{ margin: 0 }}>Vynues</h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
                Projects, and what needs doing in each — broken down as far as it takes.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {projects.length > 0 && (
                <button
                  className="btn-ghost"
                  onClick={() => openTaskDrawer(selected?.id ?? null)}
                  style={{ fontSize: 13, padding: '8px 16px' }}
                  title="Add a task (opens the side panel)"
                >
                  ＋ Add Task
                </button>
              )}
              <button className="btn-gold" onClick={() => setAdding(true)} style={{ fontSize: 13, padding: '8px 16px' }}>
                + New Project
              </button>
            </div>
          </div>

          {/* Stat strip */}
          {projects.length > 0 && (
            <div className="stat-strip">
              {[
                { label: 'Open tasks', value: openCount,     color: 'var(--accent)' },
                { label: 'Due today',  value: dueTodayCount, color: 'var(--color-amber)' },
                { label: 'Overdue',    value: overdueCount,  color: overdueCount > 0 ? 'var(--color-crimson)' : 'var(--text-dim)' },
                { label: 'Completed',  value: doneCount,     color: 'var(--color-emerald)' },
              ].map((st, i) => (
                <motion.div
                  key={st.label}
                  className="stat-tile"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <span style={{ fontSize: 22, fontWeight: 800, color: st.color, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                    {st.value}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {st.label}
                  </span>
                </motion.div>
              ))}
            </div>
          )}

          {projects.length === 0 ? (
            <EmptyState onAdd={() => setAdding(true)} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 18, alignItems: 'start' }}>

              {/* ── Sidebar: projects ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['all', 'active', 'paused', 'done'] as StatusFilter[]).map(f => (
                    <FilterChip
                      key={f}
                      label={f === 'all' ? 'All' : STATUS_META[f].label}
                      count={counts[f]}
                      active={filter === f}
                      onClick={() => setFilter(f)}
                    />
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <MenuSelect label="Sort" value={sort} options={SORT_OPTS} onChange={setSort} />
                  <MenuSelect label="Due" value={dueFilter} options={DUE_OPTS} onChange={setDueFilter} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {visible.length === 0 ? (
                    <p style={{ color: 'var(--text-dim)', fontSize: 13, padding: '12px 4px' }}>
                      No projects in this view.
                    </p>
                  ) : visible.map((p, i) => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                    >
                      <ProjectCard
                        project={p}
                        selected={selected?.id === p.id}
                        onSelect={() => setSelectedId(p.id)}
                        onAddTask={() => openTaskDrawer(p.id)}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* ── Detail: tasks ── */}
              <div>
                <AnimatePresence mode="wait">
                  {selected ? (
                    <motion.div
                      key={selected.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ProjectDetail
                        project={selected}
                        onEdit={() => setEditing(selected)}
                        onDelete={() => handleDeleteProject(selected)}
                        onAddTask={() => openTaskDrawer(selected.id)}
                        onEditTask={taskId => setEditTarget({ kind: 'vynues', projectId: selected.id, taskId })}
                      />
                    </motion.div>
                  ) : (
                    <div className="parchment" style={{ borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
                      <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Select a project to see its tasks.</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </div>

      <VynuesProjectModal
        open={adding || !!editing}
        project={editing ?? undefined}
        onClose={() => { setAdding(false); setEditing(null); }}
      />

      <VynuesTaskCreateDrawer
        open={drawerOpen}
        target={target}
        onClose={() => setDrawerOpen(false)}
      />

      <TaskEditDrawer target={editTarget} onClose={() => setEditTarget(null)} />
    </>
  );
}

// ── Sidebar pieces ────────────────────────────────────────────────────────────

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="chip"
      data-active={active}
      style={{ padding: '5px 11px', fontSize: 12 }}
    >
      {label} <span className="chip-count">{count}</span>
    </button>
  );
}

function ProjectCard({ project, selected, onSelect, onAddTask }: {
  project: VynuesProject;
  selected: boolean;
  onSelect: () => void;
  onAddTask: () => void;
}) {
  const { done, total } = projectProgress(project);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const accent = COLOR_VAR[project.color];
  const open = total - done;
  const [hover, setHover] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="parchment project-card"
      data-selected={selected}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', position: 'relative',
        borderRadius: 14, padding: '14px 15px',
        borderLeft: `3px solid ${accent}`,
        outline: selected ? '1.5px solid var(--accent-border)' : 'none',
        background: selected ? 'var(--accent-soft)' : 'var(--card-bg)',
        transition: 'background 0.15s, outline 0.15s, transform 0.18s, box-shadow 0.18s',
        transform: hover && !selected ? 'translateY(-1px)' : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_META[project.status].dot, flexShrink: 0 }} title={STATUS_META[project.status].label} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--page-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          {open > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: accent, background: 'var(--input-bg)',
              border: `1px solid ${accent}`, borderRadius: 999, padding: '1px 7px',
              fontVariantNumeric: 'tabular-nums', opacity: 0.9,
            }}>
              {open}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onAddTask(); }}
            title={`Add a task to ${project.name}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, padding: 0, borderRadius: 5,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-dim)', fontSize: 13, lineHeight: 1,
              opacity: hover ? 1 : 0, transition: 'opacity 0.15s, color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = accent)}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
          >
            ＋
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <div className="hp-track" style={{ flex: 1 }}>
          <motion.div
            className="hp-fill"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ background: accent }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {done}/{total}
        </span>
      </div>
    </div>
  );
}

// ── Detail pane ────────────────────────────────────────────────────────────────

/** Task buckets, in display order. Repeating tasks live in their own lane. */
type Bucket = 'overdue' | 'today' | 'upcoming' | 'someday' | 'repeats';
const BUCKET_META: Record<Bucket, { label: string; color?: string }> = {
  overdue:  { label: 'Overdue', color: 'var(--color-crimson)' },
  today:    { label: 'Due today', color: 'var(--color-amber)' },
  upcoming: { label: 'Upcoming' },
  someday:  { label: 'Anytime' },
  repeats:  { label: 'Repeats' },
};

function bucketOf(t: VynuesTask): Bucket {
  if (repeats(t)) return 'repeats';
  if (!t.dueDate) return 'someday';
  const due = new Date(t.dueDate).getTime();
  if (due < Date.now()) return 'overdue';
  if (due <= nextReset5am()) return 'today';
  return 'upcoming';
}

function ProjectDetail({ project, onEdit, onDelete, onAddTask, onEditTask }: {
  project: VynuesProject;
  onEdit: () => void;
  onDelete: () => void;
  onAddTask: () => void;
  onEditTask: (taskId: string) => void;
}) {
  const updateProject = useVynuesStore(s => s.updateProject);
  const accent = COLOR_VAR[project.color];
  const { done, total } = projectProgress(project);

  const cmp = (a: VynuesTask, b: VynuesTask) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    if (da !== db) return da - db;
    return PRIORITY_META[b.priority].weight - PRIORITY_META[a.priority].weight;
  };

  const buckets = useMemo(() => {
    const map = new Map<Bucket, VynuesTask[]>();
    for (const t of project.tasks) {
      if (!repeats(t) && t.done) continue;   // one-off done → Completed
      const b = bucketOf(t);
      map.set(b, [...(map.get(b) ?? []), t]);
    }
    for (const [k, list] of map) map.set(k, list.sort(cmp));
    return map;
  }, [project.tasks]);

  const completed = useMemo(() => project.tasks.filter(t => !repeats(t) && t.done), [project.tasks]);
  const bucketOrder: Bucket[] = ['overdue', 'today', 'upcoming', 'someday', 'repeats'];

  return (
    <div className="parchment" style={{ borderRadius: 16, padding: 0, overflow: 'hidden' }}>
      {/* accent strip */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, transparent)` }} />

      <div style={{ padding: '20px 22px' }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--page-text)', letterSpacing: '-0.01em' }}>{project.name}</h2>
            {project.description && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{project.description}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={onEdit}>Edit</button>
            <button
              className="btn-ghost"
              style={{ padding: '5px 10px', fontSize: 12, color: 'var(--danger)' }}
              onClick={onDelete}
              title="Delete project"
            >
              Delete
            </button>
          </div>
        </div>

        {/* status + progress row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(Object.keys(STATUS_META) as ProjectStatus[]).map(st => (
              <button
                key={st}
                onClick={() => updateProject(project.id, { status: st })}
                style={{
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  padding: '4px 10px', borderRadius: 999,
                  border: project.status === st ? `1px solid ${STATUS_META[st].color}` : '1px solid var(--card-border)',
                  background: project.status === st ? 'var(--accent-soft)' : 'transparent',
                  color: project.status === st ? STATUS_META[st].color : 'var(--text-dim)',
                  transition: 'all 0.15s',
                }}
              >
                {STATUS_META[st].label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 140 }}>
            <div className="hp-track" style={{ flex: 1 }}>
              <motion.div
                className="hp-fill"
                animate={{ width: `${total ? (done / total) * 100 : 0}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                style={{ background: accent }}
              />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{done}/{total} done</span>
          </div>
        </div>

        {/* add task — opens the side drawer, already pointed at this project */}
        <button
          className="btn-gold"
          onClick={onAddTask}
          style={{ marginTop: 18, width: '100%', padding: '10px', fontSize: 13, background: accent }}
        >
          ＋ Add Task
        </button>

        {/* tasks, bucketed */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {project.tasks.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: 13, padding: '8px 2px' }}>
              No tasks yet. Add the first thing you need to do.
            </p>
          ) : (
            bucketOrder.map(b => {
              const list = buckets.get(b);
              if (!list?.length) return null;
              return (
                <div key={b}>
                  <div className="rune-divider" style={{ margin: '10px 0 8px', ...(BUCKET_META[b].color ? { color: BUCKET_META[b].color } : {}) }}>
                    {BUCKET_META[b].label} · {list.length}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <AnimatePresence initial={false}>
                      {list.map(t => (
                        <TaskRow key={t.id} projectId={project.id} task={t} accent={accent} onEditTask={() => onEditTask(t.id)} />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })
          )}

          {completed.length > 0 && (
            <>
              <div className="rune-divider" style={{ margin: '12px 0 4px' }}>
                Completed · {completed.length}
              </div>
              <AnimatePresence initial={false}>
                {completed.map(t => (
                  <TaskRow key={t.id} projectId={project.id} task={t} accent={accent} onEditTask={() => onEditTask(t.id)} />
                ))}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ projectId, task, accent, onEditTask }: {
  projectId: string;
  task: VynuesTask;
  accent: string;
  onEditTask: () => void;
}) {
  const toggleTask    = useVynuesStore(s => s.toggleTask);
  const updateTask    = useVynuesStore(s => s.updateTask);
  const deleteTask    = useVynuesStore(s => s.deleteTask);
  const toggleTracked = useVynuesStore(s => s.toggleTaskTracked);
  const addSubtask    = useVynuesStore(s => s.addSubtask);
  const toggleSubtask = useVynuesStore(s => s.toggleSubtask);
  const renameSubtask = useVynuesStore(s => s.renameSubtask);
  const deleteSubtask = useVynuesStore(s => s.deleteSubtask);

  const canTrack = task.recurring !== 'daily' && task.recurring !== 'weekly';

  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(task.title);
  const [hover, setHover]       = useState(false);
  const [addingSub, setAddingSub] = useState(false);

  const prio = PRIORITY_META[task.priority];
  const dueInfo = task.dueDate ? getTaskDueInfo(task.dueDate) : null;
  const subs = vynuesSubNodes(task.subtasks);
  const subCount = taskProgress(task);

  function startEdit() {
    setDraft(task.title);
    setEditing(true);
  }
  function saveTitle() {
    const t = draft.trim();
    if (t && t !== task.title) updateTask(projectId, task.id, { title: t });
    else setDraft(task.title);
    setEditing(false);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        padding: '10px 12px', borderRadius: 10,
        background: 'var(--card-bg-raised)',
        border: '1px solid var(--card-border)',
        borderLeft: `3px solid ${task.done ? 'var(--success)' : subs.length > 0 ? accent : 'var(--card-border)'}`,
        transition: 'border-left-color 0.25s, background 0.15s',
      }}
    >
     <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <input
        type="checkbox"
        className="rune-check"
        checked={task.done}
        onChange={() => toggleTask(projectId, task.id)}
        title={subs.length > 0 ? 'Completes every step too' : undefined}
      />

      {editing ? (
        <input
          className="rune-input"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setDraft(task.title); setEditing(false); } }}
          style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
        />
      ) : (
        <span
          onDoubleClick={startEdit}
          style={{
            flex: 1, fontSize: 13.5, cursor: 'text', minWidth: 0,
            color: task.done ? 'var(--text-dim)' : 'var(--page-text)',
            textDecoration: task.done ? 'line-through' : 'none',
          }}
          title="Double-click to rename"
        >
          {task.title}
          {subCount.total > 0 && (
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: subCount.done === subCount.total ? 'var(--color-emerald)' : 'var(--text-dim)',
            }}>
              {subCount.done}/{subCount.total}
            </span>
          )}
        </span>
      )}

      {!task.done && (
        <span style={{
          fontSize: 10, fontWeight: 600, color: prio.color,
          padding: '2px 7px', borderRadius: 999,
          background: 'var(--input-bg)', border: `1px solid ${prio.color}`,
          opacity: 0.9, whiteSpace: 'nowrap',
        }}>
          {prio.label}
        </span>
      )}

      {repeats(task) && (
        <RecurrenceBadge recurring={task.recurring} intervalDays={task.intervalDays} monthlyRule={task.monthlyRule} />
      )}

      {repeats(task) && (task.streak ?? 0) > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }} title={`${task.streak}-cycle streak`}>
          🔥 {task.streak}
        </span>
      )}

      {!task.recurring && dueInfo && !task.done && (
        <span style={{ fontSize: 11, color: URGENCY_COLOR[dueInfo.urgency], whiteSpace: 'nowrap' }}>
          {dueInfo.text}
        </span>
      )}

      {canTrack && (
        <button
          onClick={() => toggleTracked(projectId, task.id)}
          title={task.tracked ? 'Tracked in Today — click to remove' : 'Track in Today'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 12, lineHeight: 1, padding: '0 2px',
            filter: task.tracked ? 'none' : 'grayscale(1)',
            opacity: task.tracked ? 1 : (hover ? 0.7 : 0),
            transition: 'opacity 0.15s',
          }}
        >
          📌
        </button>
      )}

      {/* Break the task down — inline, right here, any depth. */}
      <button
        onClick={() => setAddingSub(v => !v)}
        title="Add a step"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 13, lineHeight: 1, padding: '0 2px',
          opacity: hover || addingSub ? 0.9 : 0, transition: 'opacity 0.15s, color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = accent)}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
      >
        ＋
      </button>

      <button
        onClick={onEditTask}
        title="Edit task — priority, due date, schedule, steps…"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 13, lineHeight: 1, padding: '0 2px',
          opacity: hover ? 0.9 : 0, transition: 'opacity 0.15s',
        }}
      >
        ✎
      </button>

      <button
        onClick={() => deleteTask(projectId, task.id)}
        title="Delete task"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, padding: '0 2px',
          opacity: hover ? 0.9 : 0, transition: 'opacity 0.15s',
        }}
      >
        ×
      </button>
     </div>

      {/* ── Steps: infinitely nestable. Ticking them all completes the task. ── */}
      {(subs.length > 0 || addingSub) && (
        <div style={{ marginTop: 8, paddingLeft: 29 }}>
          <SubtaskTree
            nodes={subs}
            showRootAdd={addingSub}
            onDismissRootAdd={() => setAddingSub(false)}
            handlers={{
              onToggle: sId => toggleSubtask(projectId, task.id, sId),
              onAdd: (t, parentId) => addSubtask(projectId, task.id, t, parentId),
              onRename: (sId, t) => renameSubtask(projectId, task.id, sId, t),
              onDelete: sId => deleteSubtask(projectId, task.id, sId),
            }}
          />
        </div>
      )}
    </motion.div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="parchment" style={{ borderRadius: 16, padding: '56px 24px', textAlign: 'center' }}>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        style={{
          width: 46, height: 46, borderRadius: 13, margin: '0 auto 16px',
          background: 'var(--accent-soft)', border: '1px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', fontSize: 20, fontWeight: 700,
        }}
      >
        V
      </motion.div>
      <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600, color: 'var(--page-text)' }}>
        No projects yet
      </h2>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Create your first Vynues project to start tracking<br />the tasks you need to get done.
      </p>
      <button className="btn-gold" onClick={onAdd}>+ New Project</button>
    </div>
  );
}
