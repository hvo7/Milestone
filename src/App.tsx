import { useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useQuestStore, useUIStore } from './store';
import { useVynuesStore } from './vynuesStore';
import Today from './pages/Today';
import UndoToast from './components/UndoToast';
import CommandPalette from './components/CommandPalette';
import { startReminders } from './lib/reminders';

// Today is the landing route, so it ships in the main bundle — splitting it would
// only add a flash on launch. The other tabs are pulled in the first time they're
// opened, which keeps startup parsing (and the memory that parsed code holds) to
// just the page actually on screen.
// Chunks load by relative URL, which is why vite.config.ts pins `base: './'` —
// Electron serves the built app over file://, where an absolute /assets path
// would resolve to the filesystem root and 404.
const AllPage       = lazy(() => import('./pages/AllPage'));
const QuestsPage    = lazy(() => import('./pages/QuestsPage'));
const QuestlinePage = lazy(() => import('./pages/QuestlinePage'));
const VynuesPage    = lazy(() => import('./pages/VynuesPage'));

// Hash routing everywhere. Electron serves the built app over file://, which
// requires it — and the web build is hosted on GitHub Pages, a static file server
// with no SPA rewrite: under BrowserRouter, /Milestone/quests has no file behind
// it, so refreshing or sharing any route but the root returns GitHub's 404. Hash
// routes also sidestep needing a `basename` for the /<repo>/ subpath.
const Router = HashRouter;

/** Shown only while a route chunk is in flight — locally that's a frame or two,
 *  so it stays deliberately quiet rather than flashing a spinner. */
function RouteFallback() {
  return <div style={{ minHeight: '100vh', background: 'var(--dark-bg)' }} />;
}

function AppRoutes() {
  const checkAndResetRecurring = useQuestStore(s => s.checkAndResetRecurring);
  const checkAndResetVynues    = useVynuesStore(s => s.checkAndReset);
  const theme = useUIStore(s => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const run = () => { checkAndResetRecurring(); checkAndResetVynues(); };
    run();
    const interval = setInterval(run, 60_000);
    return () => clearInterval(interval);
  }, [checkAndResetRecurring, checkAndResetVynues]);

  // Reminders own their own timer (see lib/reminders.ts) and the call is
  // idempotent, so StrictMode's double-mount in development can't double-nudge.
  useEffect(() => { startReminders(); }, []);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/"              element={<Today />} />
        <Route path="/all"           element={<AllPage />} />
        <Route path="/quests"        element={<QuestsPage />} />
        <Route path="/questline/:id" element={<QuestlinePage />} />
        <Route path="/vynues"        element={<VynuesPage />} />
        <Route path="/tracked"       element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
      {/* Both live above the routes: a delete should be undoable after navigating
          away from what it deleted, and search is most useful when it can move
          you between pages. */}
      <CommandPalette />
      <UndoToast />
    </Router>
  );
}
