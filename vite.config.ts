/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Writes dist/asset-manifest.json — every code and style file this build
 * produced, hashed names and all.
 *
 * public/sw.js reads it at install time and takes a copy of the lot, which is
 * what makes the installed phone app work offline *past the first screen*. The
 * service worker cannot contain the list itself: it ships verbatim out of
 * public/ and the names change every build. Nor can it be derived from
 * index.html, which names only the entry chunk — the tabs are loaded on demand
 * and appear nowhere in the HTML.
 *
 * Alongside it goes dist/version.json — the same stamp that is compiled into the
 * bundle, in a file that can be read *without* running the bundle. That is the
 * whole point of it: a phone holding an old build has old code and therefore an
 * old idea of what the current version is, so it can only find out by asking the
 * server something the server answers freshly. It is a few dozen bytes, which is
 * what makes it cheap enough to poll (see src/lib/appUpdate.ts).
 */
function assetManifest(): Plugin {
  return {
    name: 'milestone-asset-manifest',
    apply: 'build',
    // Written from `writeBundle` with plain fs rather than emitted into the
    // bundle: the file is for the service worker, not for the module graph, and
    // this way it does not depend on the bundler's asset-emitting hooks.
    writeBundle(options, bundle) {
      const files = Object.keys(bundle)
        .filter(name => name.endsWith('.js') || name.endsWith('.css'))
        // Relative, like every other URL the worker handles: the app is served
        // from a /Milestone/ subpath on Pages and from / on the desktop bridge.
        .map(name => './' + name)
        .sort()
      const dir = options.dir ?? 'dist'
      // Forward slashes are fine on every platform Node writes files on.
      writeFileSync(`${dir}/asset-manifest.json`, JSON.stringify({ files }, null, 2))
      writeFileSync(`${dir}/version.json`, JSON.stringify({ version: pkg.version, builtAt: buildDate }, null, 2))
    },
  }
}

// Build stamp. `version` is the single source of truth in package.json — bump it
// with `npm run release:patch|minor|major`, never by hand in two places.
// These are substituted at build time, so the running app can state exactly which
// build it is (see the version chip in NavBar). Without that there's no way to
// tell a freshly packaged exe from a stale one.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const buildDate = new Date().toISOString()

export default defineConfig({
  plugins: [react(), tailwindcss(), assetManifest()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__:  JSON.stringify(buildDate),
    // `vite dev` never produces a packaged build, so mark it plainly rather than
    // letting a dev session masquerade as a release.
    __BUILD_MODE__:  JSON.stringify(process.env.NODE_ENV === 'production' ? 'release' : 'dev'),
  },
  build: {
    rollupOptions: {
      output: {
        // Split the big third-party dependencies out of the app chunk. They only
        // change on upgrade, so a normal release ships a small app chunk and
        // leaves the vendor code sitting in the browser's cache untouched.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'vendor-motion'
          if (/node_modules[\\/](react|react-dom|scheduler|react-router)/.test(id)) return 'vendor-react'
        },
      },
    },
  },
  test: {
    // The stores construct zustand `persist` middleware at import time, which
    // reaches for localStorage — so even the pure helpers need a DOM to be
    // importable.
    environment: 'jsdom',
    // The main process gets a look-in too. Only the pure pieces of it are worth
    // testing — anything that reaches for `electron` cannot run outside it — but
    // the version comparison that decides whether to overwrite the application
    // very much is (electron/semver.test.mjs).
    include: ['src/**/*.test.ts', 'electron/**/*.test.mjs'],
  },
})
