/**
 * Keeping the web and phone copies on the current build, without being closed
 * and reopened to find out there is one.
 *
 * The service worker was already replacing itself correctly — a changed
 * registration URL installs a new worker, `skipWaiting` makes it active and
 * `clients.claim` puts it in charge. What none of that does is change the code
 * *already running in the page*. An installed phone app is resident for days, so
 * the new worker took over and then went on serving a document whose JavaScript
 * was from the previous release: the version chip stayed put, fixes didn't
 * appear, and the only cure was force-quitting the app twice. Which is exactly
 * the "always stale" this file exists to end.
 *
 * So two independent signals, either of which is enough:
 *
 *   • `version.json`, written by the build (see vite.config.ts) and fetched with
 *     `no-store`. It is the authoritative answer because it does not depend on
 *     any of our own machinery working — a page whose worker is wedged still
 *     learns the truth from it.
 *   • `controllerchange`, which fires when a newly installed worker takes over.
 *     Free, immediate, and covers the case where the worker noticed before we
 *     asked.
 *
 * What happens next is deliberately not "reload immediately". Yanking the page
 * out from under someone mid-sentence to install a build they didn't ask for is
 * its own kind of broken. A reload while the app is *hidden* costs nothing and
 * is invisible, so that is the default path; while it is on screen the update
 * waits and says so, and the toast offers the reload as a choice.
 *
 * Electron has none of this — it loads from file://, where service workers do
 * not exist, and its update path is a new executable (electron/updater.cjs).
 */
import { create } from 'zustand';
import { APP_VERSION, BUILD_DATE } from '../buildInfo';

/**
 * How often a resident app asks whether it is current.
 *
 * Fifteen minutes is the compromise between "a release reaches my phone while I
 * am looking at it" and "a phone in a pocket is not waking its radio for this".
 * A check also happens every time the app comes back to the foreground, which is
 * the moment that actually matters, so this interval only carries the case of an
 * app left open and untouched.
 */
const CHECK_MS = 15 * 60_000;

/** Foregrounding fires far more often than it means anything — switching apps
 *  twice in a row should not be two requests. */
const MIN_CHECK_GAP_MS = 60_000;

/**
 * Guards against a reload loop.
 *
 * If a deploy is half-published — version.json updated, the new index.html not
 * yet at the edge — a page could reload, come back on the old build, see the new
 * version again and reload forever. Session-scoped, because the condition is
 * transient and a genuinely new session should be free to try again.
 */
const RELOAD_GUARD_KEY = 'milestone:update-reload';
const RELOAD_GUARD_MS = 60_000;

export interface AppUpdateStatus {
  /** This build is not the one the server is handing out. */
  ready: boolean;
  /** The version waiting, when version.json named one — for the toast's text. */
  nextVersion: string | null;
  /** When we last got an answer, ISO. Null until the first successful check. */
  checkedAt: string | null;
  /** A check is in flight, for the settings card's button. */
  busy: boolean;
  /** False in Electron and in dev, where none of this applies — the card uses
   *  it to stay out of the way rather than showing a control that does nothing. */
  supported: boolean;
}

export const useAppUpdate = create<AppUpdateStatus>(() => ({
  ready: false,
  nextVersion: null,
  checkedAt: null,
  busy: false,
  supported: false,
}));

const set = (patch: Partial<AppUpdateStatus>) => useAppUpdate.setState(patch);

let registration: ServiceWorkerRegistration | null = null;
let lastCheckedMs = 0;
/** Set the moment a reload is committed to, so two signals arriving together
 *  (version.json and controllerchange usually do) don't both call reload. */
let reloading = false;

function sessionGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* private mode; not worth failing over */ }
}

/** Have we reloaded for an update so recently that doing it again would be a
 *  loop rather than an update? */
function reloadedRecently(): boolean {
  const at = Number(sessionGet(RELOAD_GUARD_KEY) ?? 0);
  return at > 0 && Date.now() - at < RELOAD_GUARD_MS;
}

/**
 * Reload onto the new build.
 *
 * Nothing is at risk in doing so: every store persists to localStorage on write
 * (zustand `persist`), and sync publishes on a 700ms debounce, so the only thing
 * a reload can cost is text typed into an open field in the last moment. That is
 * why this is automatic when the app is hidden and a button when it is not.
 */
export function applyUpdate() {
  if (reloading) return;
  reloading = true;
  sessionSet(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
}

/** An update is waiting: take it now if nobody is looking, otherwise say so and
 *  let the toast (or the next time the app is backgrounded) settle it. */
function updateFound(nextVersion: string | null) {
  set({ ready: true, nextVersion });
  if (document.hidden && !reloadedRecently()) applyUpdate();
}

/**
 * Ask the server what the current build is.
 *
 * Two caches sit between this call and the truth, and both have to be refused.
 * `no-store` handles the HTTP one, which would otherwise answer a poll on an
 * unchanging URL with the copy it fetched an hour ago. The service worker is the
 * other, and it cannot be told from here — a worker sits *in front* of the HTTP
 * cache and its asset branch is cache-first, so it would serve the build stamp
 * belonging to the very build doing the asking. public/sw.js exempts this file
 * by name for that reason; if that exemption is ever removed, this check quietly
 * starts reporting that the app is current no matter what is deployed.
 */
export async function checkForUpdate({ force = false } = {}): Promise<void> {
  if (!useAppUpdate.getState().supported || reloading) return;
  if (!force && Date.now() - lastCheckedMs < MIN_CHECK_GAP_MS) return;
  lastCheckedMs = Date.now();
  set({ busy: true });

  // Prod the worker at the same time. It fetches the registration URL itself and
  // installs a replacement if the bytes differ, which is the mechanism that
  // actually refreshes the offline cache; the fetch below is how *we* find out.
  try { await registration?.update(); } catch { /* offline, or the worker is gone */ }

  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const body = await res.json() as { version?: string; builtAt?: string };
    set({ checkedAt: new Date().toISOString() });
    // Build stamp, not just version: two builds of 3.0.3 are different builds,
    // and a re-deploy at the same version is exactly the case that used to leave
    // a phone on the old one with nothing to notice.
    const differs = !!body.builtAt && body.builtAt !== BUILD_DATE;
    if (differs) updateFound(body.version && body.version !== APP_VERSION ? body.version : null);
  } catch {
    // Offline. Not an error worth surfacing — the app is designed to run this
    // way, and the next check is a foreground away.
  } finally {
    set({ busy: false });
  }
}

/**
 * Register the worker and keep this page honest about which build it is.
 *
 * Called once from main.tsx. Safe to call anywhere: it decides for itself
 * whether any of this applies.
 */
export function startAppUpdates() {
  const isElectron = navigator.userAgent.includes('Electron');
  if (isElectron || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  set({ supported: true });

  // Whether this page was already under a worker's control. It matters for the
  // listener below: the *first* controller a fresh page gets is the one that
  // just installed for the first time, and reloading for that would mean every
  // first visit reloads itself for no reason.
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    // A worker taking over means the build behind it changed. We may not know
    // its version — version.json fills that in on the next check if the app
    // stays open, and the toast reads fine without it.
    updateFound(null);
  });

  // Version *and build stamp* in the query string: a changed script URL is what
  // makes the browser fetch a new worker, and it keys the cache so the previous
  // build's entries get evicted. The version alone isn't enough — a re-deploy at
  // the same version (a CI re-run, a fix that doesn't warrant a bump) left the
  // old worker and its cache in place, so the phone kept serving the previous
  // build and its build stamp never moved.
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`./sw.js?v=${APP_VERSION}&b=${encodeURIComponent(BUILD_DATE)}`)
      .then(reg => {
        registration = reg;
        void checkForUpdate({ force: true });
      })
      .catch(() => {
        // An unavailable worker costs offline support, nothing more — the app
        // runs, and version.json polling below still keeps it current.
        void checkForUpdate({ force: true });
      });
  });

  // Coming back to the app is both the likeliest moment for a release to have
  // happened since you last looked and the safest moment to install one — so it
  // is a check, and going *away* is when a pending update gets taken.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (useAppUpdate.getState().ready && !reloadedRecently()) applyUpdate();
      return;
    }
    void checkForUpdate();
  });

  setInterval(() => { void checkForUpdate(); }, CHECK_MS);
}
