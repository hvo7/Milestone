import { useState, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuestStore, useUIStore } from '../store';
import SpacesModal from './SpacesModal';
import { DEFAULT_SPACES } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { VERSION_LABEL, buildSummary } from '../buildInfo';
import { lazyChunk } from '../lib/lazyChunk';
import { REFRESH_DAY_EVENT } from '../lib/dayClock';
import pondCover from '../assets/pond.webp';
import bridgeCover from '../assets/bridge.webp';
import riversideCover from '../assets/quests-riverside.png';
import lilyPondCover from '../assets/systems-lily-pond.png';
import waterGardenCover from '../assets/systems-water-garden.png';

// The nav bar is on every page, but these two panels open rarely — and the Data
// panel drags in the whole sync/backup surface. Loaded when actually opened.
const NotionSyncModal = lazyChunk(() => import('./NotionSyncModal'));
const DataModal = lazyChunk(() => import('./DataModal'));
const RemindersModal = lazyChunk(() => import('./RemindersModal'));

const isElectron = !!window.electronAPI;

export default function NavBar({ cover }: { cover?: { title: string; subtitle: string } } = {}) {
  const spaces = useQuestStore(s => s.spaces ?? DEFAULT_SPACES);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const { pathname, key: visitKey } = useLocation();
  const routines     = useQuestStore(s => s.routines);
  const questlines   = useQuestStore(s => s.questlines);
  const projects     = useVynuesStore(s => s.projects);
  const theme        = useUIStore(s => s.theme);
  const toggleTheme  = useUIStore(s => s.toggleTheme);
  const reminders    = useUIStore(s => s.reminders);
  const [syncOpen,  setSyncOpen]  = useState(false);
  const [dataOpen,  setDataOpen]  = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);

  const dailyRemaining =
    routines.filter(r => r.recurring === 'daily' && !r.completed && !r.hidden).length +
    questlines.flatMap(ql =>
      ql.quests.flatMap(q =>
        q.actions.filter(a => a.recurring === 'daily' && !a.completed && !a.hidden)
      )
    ).length;

  const tabs = [
    { path: '/',        label: 'Today',   badge: dailyRemaining },
    // Systems sits before Quests deliberately: the process is the thing you act
    // on, the goal is the thing you hope for.
    { path: '/systems', label: 'Systems', badge: 0 },
    { path: '/quests', label: 'Quests', badge: 0 },
    ...spaces.filter(s => !s.archived).map(s => ({ path: `/spaces/${s.id}`, label: s.name, badge: projects.filter(p => (p.spaceId ?? 'vynues') === s.id && p.status === 'active').reduce((n, p) => n + p.tasks.filter(t => !t.done).length, 0) })),
    { path: '/all',    label: 'All',    badge: 0 },
  ];

  // Stable throughout a visit (including edits and recurring task updates),
  // with both approved Systems scenes available on subsequent visits.
  const systemsScene = [...visitKey].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0
    ? lilyPondCover : waterGardenCover;
  const scene = pathname === '/systems' ? systemsScene
    : pathname === '/quests' || pathname.startsWith('/questline/') ? riversideCover
    : pathname === '/' || pathname === '/all' ? pondCover : bridgeCover;
  const heading = cover ?? ({
    '/': { title: 'Today', subtitle: 'Small steps, brighter days.' },
    '/systems': { title: 'Systems', subtitle: 'A little progress, consistently.' },
    '/quests': { title: 'Quests', subtitle: 'Make room for what matters.' },
    '/vynues': { title: 'Vynues', subtitle: 'A place for your next idea.' },
    '/all': { title: 'All tasks', subtitle: 'Everything in its own time.' },
  }[pathname] ?? { title: 'Quests', subtitle: 'One step closer.' });

  return (
    <>
      {import.meta.env.MODE === 'testing' && <div data-testing-banner style={{ background: '#edc16f', color: '#372b16', padding: '9px 18px', display: 'flex', gap: 14, justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 12, borderRadius: 10, marginBottom: 12 }}>
        <strong>TESTING · Batch 003 · Keep habits visible</strong>
        <span>Separate data · Sync off · Batch 003 approved for release</span>
      </div>}
      <nav className="app-nav" aria-label="Main navigation">
        <Link to="/" className="app-brand" aria-label="Milestone home">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19V9l4-4 4 7 4-7 4 4v10M8 19v-5m8 5v-5" />
            </svg>
          </span>
          <span className="brand-name">Milestone</span>
          <span className="build-label" title={buildSummary()}>{VERSION_LABEL}</span>
        </Link>
        <div className="app-tabs">
          {tabs.map(tab => {
            const active = tab.path === '/' ? pathname === '/' : ((pathname === tab.path || pathname.startsWith(tab.path + '/')) || (tab.path === '/quests' && pathname.startsWith('/questline/')));
            return (
              <Link key={tab.path} to={tab.path} className="nav-link" aria-current={active ? 'page' : undefined}>
                {tab.label}
                {tab.badge > 0 && <span className="nav-count">{tab.badge}</span>}
              </Link>
            );
          })}
        </div>
        <div className="nav-tools">
          <button type="button" className="nav-tool" onClick={() => window.dispatchEvent(new Event(REFRESH_DAY_EVENT))}
            title="Refresh tasks — new day starts at 2:00 AM local time" aria-label="Refresh tasks">
            <NavIcon name="sync" />
          </button>
          <button className="nav-tool" onClick={() => setSpacesOpen(true)} title="Add or manage space tabs" aria-label="Add or manage space tabs">＋</button>
          <button className="nav-tool" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <NavIcon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className="nav-tool" onClick={() => setRemindOpen(true)} data-active={!!reminders?.enabled} title={reminders?.enabled ? `Daily reminder at ${reminders.time}` : 'Daily reminder — off'} aria-label="Daily reminder">
            <NavIcon name="bell" />
          </button>
          <button className="nav-tool" onClick={() => setDataOpen(true)} title="Export / Import data" aria-label="Export / Import data">
            <NavIcon name="data" />
          </button>
          {isElectron && <button className="nav-tool" onClick={() => setSyncOpen(true)} title="Sync to Notion" aria-label="Sync to Notion"><NavIcon name="sync" /></button>}
        </div>
      </nav>
      <header className="water-cover" style={{ backgroundImage: `url("${scene}")` }}>
        <div className="water-cover-content">
          <h1>{heading.title}</h1>
          <p>{heading.subtitle}</p>
        </div>
      </header>

      <Suspense fallback={null}>
        {spacesOpen && <SpacesModal onClose={() => setSpacesOpen(false)} />}
        {syncOpen   && <NotionSyncModal onClose={() => setSyncOpen(false)} />}
        {dataOpen   && <DataModal       onClose={() => setDataOpen(false)} />}
        {remindOpen && <RemindersModal  onClose={() => setRemindOpen(false)} />}
      </Suspense>
    </>
  );
}

function NavIcon({ name }: { name: 'sun' | 'moon' | 'bell' | 'data' | 'sync' }) {
  const paths = {
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9M10 21h4" /></>,
    data: <><path d="M8 3v12m-4-4 4 4 4-4M16 21V9m-4 4 4-4 4 4" /></>,
    sync: <><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" /></>,
  };
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
