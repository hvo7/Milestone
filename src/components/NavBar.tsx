import { useState, lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuestStore, useUIStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { VERSION_LABEL, BUILD_MODE, buildSummary } from '../buildInfo';

// The nav bar is on every page, but these two panels open rarely — and the Data
// panel drags in the whole sync/backup surface. Loaded when actually opened.
const NotionSyncModal = lazy(() => import('./NotionSyncModal'));
const DataModal = lazy(() => import('./DataModal'));
const RemindersModal = lazy(() => import('./RemindersModal'));

const isElectron = !!window.electronAPI;

export default function NavBar() {
  const { pathname } = useLocation();
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

  // Open tasks across active Vynues projects.
  const vynuesOpen = projects
    .filter(p => p.status === 'active')
    .reduce((n, p) => n + p.tasks.filter(t => !t.done).length, 0);

  const tabs = [
    { path: '/',        label: 'Today',   badge: dailyRemaining },
    // Systems sits before Quests deliberately: the process is the thing you act
    // on, the goal is the thing you hope for.
    { path: '/systems', label: 'Systems', badge: 0 },
    { path: '/quests', label: 'Quests', badge: 0 },
    { path: '/vynues', label: 'Vynues', badge: vynuesOpen },
    { path: '/all',    label: 'All',    badge: 0 },
  ];

  function iconBtnStyle(): React.CSSProperties {
    return {
      background: 'transparent',
      border: '1px solid var(--card-border)',
      borderRadius: 9, cursor: 'pointer',
      fontSize: 13, padding: '6px 10px',
      color: 'var(--text-dim)', transition: 'all 0.15s',
      lineHeight: 1,
    };
  }

  const hoverOn  = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.color = 'var(--accent)'; };
  const hoverOff = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.borderColor = 'var(--card-border)'; e.currentTarget.style.color = 'var(--text-dim)'; };

  return (
    <>
      <nav className="app-nav" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        // Padding lives in `.app-nav` (index.css) — it carries the phone's top
        // safe-area inset, and an inline padding here would silently outrank it.
        borderBottom: '1px solid var(--nav-border)',
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(14px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        transition: 'background 0.3s, border-color 0.3s',
      }}>
        {/* Brand */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, userSelect: 'none' }}>
          <motion.span
            whileHover={{ rotate: 8, scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 320, damping: 16 }}
            style={{
              width: 24, height: 24, borderRadius: 7,
              background: 'var(--grad-accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 800,
              boxShadow: '0 2px 10px rgba(99,102,241,0.35)',
            }}
          >
            M
          </motion.span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 14.5, fontWeight: 700, color: 'var(--page-text)', letterSpacing: '-0.01em' }}>
            Milestone
          </span>
          {/* Which build is actually running. A packaged exe is only as current as
              the last `npm run package`, so this is how you tell at a glance. */}
          <span
            title={buildSummary()}
            style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.03em',
              padding: '2px 6px', borderRadius: 999, cursor: 'default',
              color: BUILD_MODE === 'dev' ? 'var(--color-amber)' : 'var(--text-dim)',
              border: `1px solid ${BUILD_MODE === 'dev' ? 'var(--color-amber)' : 'var(--card-border)'}`,
              background: BUILD_MODE === 'dev' ? 'transparent' : 'var(--input-bg)',
              whiteSpace: 'nowrap',
            }}
          >
            {VERSION_LABEL}
          </span>
        </span>

        {/* Tabs — the active pill glides between them */}
        <div className="app-tabs" style={{
          display: 'flex', gap: 2, padding: 3,
          borderRadius: 12, border: '1px solid var(--card-border)',
          background: 'var(--input-bg)',
        }}>
          {tabs.map(tab => {
            const active = pathname === tab.path;
            return (
              <Link key={tab.path} to={tab.path} style={{ textDecoration: 'none' }}>
                <button style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', padding: '6px 14px', borderRadius: 9,
                  border: 'none', background: 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-dim)',
                  transition: 'color 0.2s',
                }}>
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      style={{
                        position: 'absolute', inset: 0, borderRadius: 9,
                        background: 'var(--accent-soft)',
                        border: '1px solid var(--accent-border)',
                      }}
                    />
                  )}
                  <span style={{ position: 'relative', zIndex: 1 }}>{tab.label}</span>
                  {tab.badge > 0 && (
                    <span style={{
                      position: 'relative', zIndex: 1,
                      background: 'var(--grad-accent)', color: '#fff',
                      borderRadius: 999, fontSize: 10, fontWeight: 700,
                      padding: '1px 7px', lineHeight: 1.6,
                    }}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              </Link>
            );
          })}
        </div>

        {/* Icon buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={iconBtnStyle()}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>

          <button
            onClick={() => setRemindOpen(true)}
            title={reminders?.enabled ? `Daily reminder at ${reminders.time}` : 'Daily reminder — off'}
            style={{ ...iconBtnStyle(), ...(reminders?.enabled ? { color: 'var(--accent)', borderColor: 'var(--accent-border)' } : {}) }}
            onMouseEnter={hoverOn}
            onMouseLeave={e => { if (!reminders?.enabled) hoverOff(e); }}
          >
            🔔
          </button>

          <button
            onClick={() => setDataOpen(true)}
            title="Export / Import data"
            style={iconBtnStyle()}
            onMouseEnter={hoverOn}
            onMouseLeave={hoverOff}
          >
            ⇅
          </button>

          {isElectron && (
            <button
              onClick={() => setSyncOpen(true)}
              title="Sync to Notion"
              style={iconBtnStyle()}
              onMouseEnter={hoverOn}
              onMouseLeave={hoverOff}
            >
              ↻
            </button>
          )}
        </div>
      </nav>

      <Suspense fallback={null}>
        {syncOpen   && <NotionSyncModal onClose={() => setSyncOpen(false)} />}
        {dataOpen   && <DataModal       onClose={() => setDataOpen(false)} />}
        {remindOpen && <RemindersModal  onClose={() => setRemindOpen(false)} />}
      </Suspense>
    </>
  );
}
