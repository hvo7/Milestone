import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startCloudSync } from './lib/cloudSync'
import { startAutoBackup } from './lib/autoBackup'
import { startAppUpdates } from './lib/appUpdate'

// Snapshot to disk *before* sync starts: adopting a peer's data legitimately
// replaces everything on this machine, and the copy it replaced should already
// be on disk by then.
startAutoBackup()

// Kicked off alongside the first render rather than awaited: the app should come
// up on local data immediately, and fold in the other computer's changes when the
// folder read completes a moment later.
void startCloudSync()

// Registers the offline shell for the web/mobile build, and keeps this page on
// the current build once it is running — see lib/appUpdate.ts, which decides for
// itself that none of this applies under Electron or in dev.
startAppUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
