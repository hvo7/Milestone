import { useEffect, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuestStore, useUIStore } from './store';
import { useVynuesStore } from './vynuesStore';
import Today from './pages/Today';
import UndoToast from './components/UndoToast';
import UpdateToast from './components/UpdateToast';
import CommandPalette from './components/CommandPalette';
import NavBar from './components/NavBar';
import RouteBoundary from './components/RouteBoundary';
import { startReminders } from './lib/reminders';
import { startHistory, installUndoHotkeys, withoutHistory } from './lib/history';
import { lazyChunk } from './lib/lazyChunk';

// Today is the landing route, so it ships in the main bundle — splitting it would
// only add a flash on launch. The other tabs are pulled in the first time they're
// opened, which keeps startup parsing (and the memory that parsed code holds) to
// just the page actually on screen.
// Chunks load by relative URL, which is why vite.config.ts pins `base: './'` —
// Electron serves the built app over file://, where an absolute /assets path
// would resolve to the filesystem root and 404.
// `lazyChunk` rather than `lazy`: on a phone that fetch fails often enough to
// matter, and a rejected import with nothing to catch it unmounts the whole app.
// See lib/lazyChunk.ts and components/RouteBoundary.tsx.
const AllPage       = lazyChunk(() => import('./pages/AllPage'));
const SystemsPage   = lazyChunk(() => import('./pages/SystemsPage'));
const QuestsPage    = lazyChunk(() => import('./pages/QuestsPage'));
const QuestlinePage = lazyChunk(() => import('./pages/QuestlinePage'));
const VynuesPage    = lazyChunk(() => import('./pages/VynuesPage'));

// Hash routing everywhere. Electron serves the built app over file://, which
// requires it — and the web build is hosted on GitHub Pages, a static file server
// with no SPA rewrite: under BrowserRouter, /Milestone/quests has no file behind
// it, so refreshing or sharing any route but the root returns GitHub's 404. Hash
// routes also sidestep needing a `basename` for the /<repo>/ subpath.
const Router = HashRouter;

/**
 * Shown while a route chunk is in flight.
 *
 * The nav bar is part of it deliberately. "A frame or two" is a desktop
 * assumption: on a phone fetching a tab for the first time this is a real
 * wait, and an empty page for a second or two is indistinguishable from the
 * app having died — which is the complaint this whole area exists to answer.
 * Keeping the chrome means a slow tab looks like a slow tab, and the other
 * tabs stay tappable while it loads.
 *
 * Below it stays quiet rather than flashing a spinner that usually resolves
 * before it can be read.
 */
function RouteFallback() {
  return (
    <>
      <NavBar />
      <div style={{ minHeight: '60vh' }} />
    </>
  );
}

function AppRoutes() {
  const checkAndResetRecurring = useQuestStore(s => s.checkAndResetRecurring);
  const checkAndResetVynues    = useVynuesStore(s => s.checkAndReset);
  const theme = useUIStore(s => s.theme);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    // Recorded from here on, so the hydrated state is the floor Ctrl+Z stops at.
    startHistory();
    return installUndoHotkeys();
  }, []);

  useEffect(() => {
    // Outside the history: a day turning over is not something you did, and
    // Ctrl+Z stepping back through a rollover would take the day with it.
    const run = () => withoutHistory(() => { checkAndResetRecurring(); checkAndResetVynues(); });
    run();
    const interval = setInterval(run, 60_000);
    return () => clearInterval(interval);
  }, [checkAndResetRecurring, checkAndResetVynues]);

  // Reminders own their own timer (see lib/reminders.ts) and the call is
  // idempotent, so StrictMode's double-mount in development can't double-nudge.
  useEffect(() => { startReminders(); }, []);

  return (
    // The boundary sits outside Suspense so it catches the chunk that never
    // arrived as well as anything the page throws once it has. `key` changes on
    // every navigation and `pathname` covers the first entry, which has no key
    // of its own yet — together they make any tap a fresh attempt, including a
    // second tap on the tab that just failed.
    <RouteBoundary resetKey={`${location.key}:${location.pathname}`}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/"              element={<Today />} />
          <Route path="/all"           element={<AllPage />} />
          <Route path="/systems"       element={<SystemsPage />} />
          <Route path="/quests"        element={<QuestsPage />} />
          <Route path="/questline/:id" element={<QuestlinePage />} />
          <Route path="/vynues"        element={<VynuesPage />} />
          <Route path="/tracked"       element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </RouteBoundary>
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
      {/* Same reasoning: a release can land on any page, and the offer to take
          it should not depend on which one you happen to be looking at. */}
      <UpdateToast />
    </Router>
  );
}
