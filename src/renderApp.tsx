import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startCloudSync } from './lib/cloudSync'
import { startAutoBackup } from './lib/autoBackup'
import { startAppUpdates } from './lib/appUpdate'

if (import.meta.env.MODE !== 'testing') {
  startAutoBackup()
  void startCloudSync()
  startAppUpdates()
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
