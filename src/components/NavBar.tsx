import { useState, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuestStore, useUIStore } from '../store';
import SpacesModal from './SpacesModal';
import ModalShell from './ModalShell';
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
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <strong>TESTING · Batch 005 · Today pin fixes</strong>
        <span>Separate data · Sync off · Batch 005 approved for release</span>
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
          <button type="button" className="nav-tool" onClick={() => setSpacesOpen(true)} title="Add or manage space tabs" aria-label="Add new tab">＋</button>
          <button type="button" className="nav-tool" onClick={() => window.dispatchEvent(new Event(REFRESH_DAY_EVENT))}
            title="Reload tasks — new day starts at 2:00 AM local time" aria-label="Reload tasks">
            <NavIcon name="reload" />
          </button>
          <button type="button" className="nav-tool" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings" aria-haspopup="dialog">
            <NavIcon name="settings" />
          </button>
        </div>
      </nav>
      <header className="water-cover" style={{ backgroundImage: `url("${scene}")` }}>
        <div className="water-cover-content">
          <h1>{heading.title}</h1>
          <p>{heading.subtitle}</p>
        </div>
      </header>

      <Suspense fallback={null}>
        {settingsOpen && <ModalShell onClose={() => setSettingsOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="settings-heading" onKeyDown={e => { if (e.key === 'Escape') setSettingsOpen(false); }}>
            <h2 id="settings-heading" style={{ marginTop: 0 }}>Settings</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <button type="button" autoFocus className="btn-ghost" onClick={toggleTheme}>Appearance · {theme === 'dark' ? 'Dark' : 'Light'} — switch theme</button>
              <button type="button" className="btn-ghost" onClick={() => { setSettingsOpen(false); setRemindOpen(true); }}>Notifications · {reminders?.enabled ? reminders.time : 'Off'}</button>
              <button type="button" className="btn-ghost" onClick={() => { setSettingsOpen(false); setDataOpen(true); }}>Data, backups, sync &amp; updates</button>
              <button type="button" className="btn-ghost" disabled={!isElectron} onClick={() => { setSettingsOpen(false); setSyncOpen(true); }}>Notion import / export{!isElectron && ' · Desktop only'}</button>
              <button type="button" className="btn-ghost" onClick={() => setSettingsOpen(false)}>Close</button>
            </div>
          </section>
        </ModalShell>}
        {spacesOpen && <SpacesModal onClose={() => setSpacesOpen(false)} />}
        {syncOpen   && <NotionSyncModal onClose={() => setSyncOpen(false)} />}
        {dataOpen   && <DataModal       onClose={() => setDataOpen(false)} />}
        {remindOpen && <RemindersModal  onClose={() => setRemindOpen(false)} />}
      </Suspense>
    </>
  );
}

function NavIcon({ name }: { name: 'reload' | 'settings' }) {
  const paths = {
    reload: <path d="M20 4v6h-6M20 10a8 8 0 1 0-1 7" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m10 3-1 3-2 1-3-1-2 4 2 2v2l-2 2 2 4 3-1 2 1 1 3h4l1-3 2-1 3 1 2-4-2-2v-2l2-2-2-4-3 1-2-1-1-3Z" transform="translate(0 -1) scale(1 .95)" /></>,
  };
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
