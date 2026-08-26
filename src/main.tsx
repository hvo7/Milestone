import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startCloudSync } from './lib/cloudSync'
import { startAutoBackup } from './lib/autoBackup'
import { APP_VERSION, BUILD_DATE } from './buildInfo'

// Snapshot to disk *before* sync starts: adopting a peer's data legitimately
// replaces everything on this machine, and the copy it replaced should already
// be on disk by then.
startAutoBackup()

// Kicked off alongside the first render rather than awaited: the app should come
// up on local data immediately, and fold in the other computer's changes when the
// folder read completes a moment later.
void startCloudSync()

// Offline shell for the web/mobile build, so the installed PWA opens without a
// network. Skipped under Electron, which already serves everything from disk over
// file:// (where service workers aren't available anyway), and skipped in dev so
// a stale worker can't shadow Vite's module graph mid-session.
if (!navigator.userAgent.includes('Electron') && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Version *and build stamp* in the query string: a changed script URL is what
    // makes the browser fetch a new worker, and it keys the cache so the previous
    // build's entries get evicted. The version alone isn't enough — a re-deploy at
    // the same version (a CI re-run, a fix that doesn't warrant a bump) left the
    // old worker and its cache in place, so the phone kept serving the previous
    // build and its build stamp never moved.
    void navigator.serviceWorker.register(
      `./sw.js?v=${APP_VERSION}&b=${encodeURIComponent(BUILD_DATE)}`,
    ).catch(() => {
      // An unavailable worker costs offline support, nothing more — the app runs.
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
