import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// Build stamp. `version` is the single source of truth in package.json — bump it
// with `npm run release:patch|minor|major`, never by hand in two places.
// These are substituted at build time, so the running app can state exactly which
// build it is (see the version chip in NavBar). Without that there's no way to
// tell a freshly packaged exe from a stale one.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const buildDate = new Date().toISOString()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__:  JSON.stringify(buildDate),
    // `vite dev` never produces a packaged build, so mark it plainly rather than
    // letting a dev session masquerade as a release.
    __BUILD_MODE__:  JSON.stringify(process.env.NODE_ENV === 'production' ? 'release' : 'dev'),
  },
})
