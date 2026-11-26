import { useState, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuestStore, useUIStore } from '../store';
import SpacesModal from './SpacesModal';
import { useSyncIssues } from '../lib/syncIssues';
import SettingsModal from './SettingsModal';
import { DEFAULT_SPACES } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { VERSION_LABEL, buildSummary } from '../buildInfo';
import { lazyChunk } from '../lib/lazyChunk';
import { REFRESH_DAY_EVENT } from '../lib/dayClock';
import { routineIsArchived } from '../lib/archive';
import { motionMs } from '../lib/motion';
import PageBanner from './PageBanner';
import Icon from './Icon';

// The nav bar is on every page, but these two panels open rarely — and the Data
// panel drags in the whole sync/backup surface. Loaded when actually opened.
const NotionSyncModal = lazyChunk(() => import('./NotionSyncModal'));
const DataModal = lazyChunk(() => import('./DataModal'));
const RemindersModal = lazyChunk(() => import('./RemindersModal'));

const isElectron = !!window.electronAPI;

export default function NavBar({ cover, hideCover = false }: { cover?: { title: string; subtitle?: string }; hideCover?: boolean } = {}) {
  const spaces = useQuestStore(s => s.spaces ?? DEFAULT_SPACES);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const { pathname } = useLocation();
  const routines     = useQuestStore(s => s.routines);
  const questlines   = useQuestStore(s => s.questlines);
  const systems     = useQuestStore(s => s.systems);
  const projects     = useVynuesStore(s => s.projects);
  const resetTime = useUIStore(s => s.resetTime);
  const theme        = useUIStore(s => s.theme);
  const toggleTheme  = useUIStore(s => s.toggleTheme);
  const reminders    = useUIStore(s => s.reminders);
  const [syncOpen,  setSyncOpen]  = useState(false);
  const [dataOpen,  setDataOpen]  = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const syncReview = useSyncIssues(s => s.issues.filter(issue => issue.status === 'open').length);

  const dailyRemaining =
    routines.filter(r => r.recurring === 'daily' && !r.completed && !routineIsArchived(r, questlines, systems)).length +
    questlines.filter(ql => !ql.hidden).flatMap(ql =>
      ql.quests.filter(q => !q.hidden).flatMap(q =>
        q.actions.filter(a => a.recurring === 'daily' && !a.completed && !a.hidden)
      )
    ).length;

  const tabs = [
    { path: '/',        label: 'Today',   badge: dailyRemaining },
    { path: '/vitals', label: 'Life Vitals', badge: 0 },
    // Systems sits before Quests deliberately: the process is the thing you act
    // on, the goal is the thing you hope for.
    { path: '/systems', label: 'Systems', badge: 0 },
    { path: '/quests', label: 'Quests', badge: 0 },
    ...spaces.filter(s => !s.archived).map(s => ({ path: `/spaces/${s.id}`, label: s.name, badge: projects.filter(p => (p.spaceId ?? 'vynues') === s.id && p.status === 'active').reduce((n, p) => n + p.tasks.filter(t => !t.done).length, 0) })),
    { path: '/all',    label: 'All',    badge: 0 },
  ];

  const heading = cover ?? ({
    '/': { title: 'Today' },
    '/systems': { title: 'Systems' },
    '/quests': { title: 'Quests' },
    '/vynues': { title: 'Vynues' },
    '/all': { title: 'All tasks' },
  }[pathname] ?? { title: 'Quests' });

  return (
    <>
      {import.meta.env.MODE === 'testing' && <div data-testing-banner className="testing-banner">
        <strong>TESTING · Pondside</strong>
        <span>Separate data · Sync off · Pending review</span>
      </div>}
      <nav className="app-nav" aria-label="Main navigation">
        <Link to="/" className="app-brand" aria-label="Milestone home">
          <span className="brand-mark"><Icon name="pond" size={20} /></span>
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
          <button type="button" className="nav-tool" onClick={() => window.dispatchEvent(new Event('milestone:open-search'))}
            title="Search (Ctrl K or /)" aria-label="Search" aria-haspopup="dialog">
            <Icon name="search" />
          </button>
          <button type="button" className="nav-tool" data-phone="hide" onClick={() => setSpacesOpen(true)} title="Add or manage space tabs" aria-label="Add new tab">
            <Icon name="plus" />
          </button>
          <button type="button" className="nav-tool" data-phone="hide" onClick={toggleTheme} title={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="nav-tool" data-phone="hide" onClick={event => {
            const icon = event.currentTarget.querySelector('svg');
            icon?.getAnimations().forEach(animation => animation.cancel());
            const spin = motionMs('day-closed');
            if (spin > 0) icon?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: spin, easing: 'ease-out' });
            window.dispatchEvent(new Event(REFRESH_DAY_EVENT));
          }}
            title={`Reload tasks — new day starts at ${resetTime} local time`} aria-label="Reload tasks">
            <Icon name="reload" />
          </button>
          <button type="button" className="nav-tool nav-tool-badged" onClick={() => setSettingsOpen(true)}
            title={syncReview ? `Settings — ${syncReview} sync ${syncReview === 1 ? 'item' : 'items'} to review` : 'Settings'}
            aria-label={syncReview ? `Settings, ${syncReview} sync ${syncReview === 1 ? 'item' : 'items'} to review` : 'Settings'} aria-haspopup="dialog">
            <Icon name="settings" />
            {syncReview > 0 && <span className="nav-count nav-tool-count" aria-hidden="true">{syncReview}</span>}
          </button>
        </div>
      </nav>
      {!hideCover && <header className="page-banner-wrap">
        <PageBanner pathname={pathname} />
        <h1 className="page-title">{heading.title}</h1>
      </header>}

      <Suspense fallback={null}>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)}
          notifications={reminders?.enabled ? reminders.time : 'Off'} desktop={isElectron}
          onNotifications={() => { setSettingsOpen(false); setRemindOpen(true); }}
          onData={() => { setSettingsOpen(false); setDataOpen(true); }} syncReview={syncReview}
          onNotion={() => { setSettingsOpen(false); setSyncOpen(true); }}
          onSpaces={() => { setSettingsOpen(false); setSpacesOpen(true); }} />}
        {spacesOpen && <SpacesModal onClose={() => setSpacesOpen(false)} />}
        {syncOpen   && <NotionSyncModal onClose={() => setSyncOpen(false)} />}
        {dataOpen   && <DataModal       onClose={() => setDataOpen(false)} />}
        {remindOpen && <RemindersModal  onClose={() => setRemindOpen(false)} />}
      </Suspense>
    </>
  );
}
