import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useQuestStore, useUIStore } from './store';
import { useVynuesStore } from './vynuesStore';
import Today from './pages/Today';

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

// Electron serves the built app over file://, which requires hash-based routing.
const isElectron = navigator.userAgent.includes('Electron');
const Router = isElectron ? HashRouter : BrowserRouter;

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
    </Router>
  );
}
