/**
 * Build stamp, substituted by Vite at build time (see `define` in vite.config.ts).
 *
 * The point is answering "is the app I'm looking at actually the build I just
 * made?" — the version chip in the nav bar reads from here, so a stale exe is
 * obvious at a glance instead of being guessed at.
 */

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __BUILD_MODE__: string;

/** Semver from package.json, e.g. "1.1.0". */
export const APP_VERSION = __APP_VERSION__;

/** ISO instant the bundle was built. */
export const BUILD_DATE = __BUILD_DATE__;

/** 'release' for a production build, 'dev' when served by `npm run dev`. */
export const BUILD_MODE = __BUILD_MODE__;

/** Short display version, e.g. "v1.1.0" (or "v1.1.0-dev" in a dev server). */
export const VERSION_LABEL = `v${APP_VERSION}${BUILD_MODE === 'dev' ? '-dev' : ''}`;

/** Local, human-readable build time — "Jul 19, 2026, 4:21 PM". */
export function buildDateLabel(): string {
  const d = new Date(BUILD_DATE);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** One-line summary for tooltips and the data modal. */
export const buildSummary = () => `Milestone ${VERSION_LABEL} · built ${buildDateLabel()}`;
