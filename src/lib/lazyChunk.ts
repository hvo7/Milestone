/**
 * Code-split chunks, loaded so a phone's network can't blank the whole app.
 *
 * Every tab but Today — and every drawer and modal — arrives as its own chunk,
 * fetched the first time it is opened. On a desktop that request never fails. On
 * a phone it fails routinely: the installed app is opened with no signal, the
 * connection drops mid-request, or it was left on the home screen across a
 * deploy and the chunk it remembers has since been replaced on the server.
 *
 * A rejected `import()` reaches React through `lazy()`, and an error thrown with
 * no boundary above it unmounts the entire tree — a blank screen with no nav bar
 * and nothing to tap, recoverable only by killing the app. That is why Quests,
 * Vynues and All looked unopenable on the phone while Today, the one page in the
 * main bundle, went on working.
 *
 * So a load gets three chances before anyone sees an error:
 *   1. retry — most failures are a single dropped request;
 *   2. one reload — a chunk that is genuinely *gone* needs a fresh index.html
 *      naming the new one, and no amount of retrying will conjure the old one;
 *   3. RouteBoundary — keeps the nav bar on screen and offers a way back.
 *
 * React's `lazy` caches a rejection for the life of the page, so the retrying
 * has to happen here, inside the factory, before it ever escapes to React.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/** Set once we've reloaded to chase a missing chunk, so we can't loop on it.
 *  Session-scoped on purpose: it should be forgotten when the tab is. */
const RELOAD_KEY = 'milestone:chunk-reload';

/** Storage in a PWA can throw (private mode, a locked profile). None of this is
 *  worth failing a page load over. */
function sessionGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* nothing to do about it */ }
}
function sessionClear(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* nothing to do about it */ }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Last resort: reload, so the browser fetches index.html again and learns the
 * current build's chunk names. Returns whether a reload is actually under way.
 *
 * Refused twice over. Once per session, because a chunk missing for some other
 * reason would otherwise reload forever. And never while offline — there is no
 * newer index.html to be had, and a reload would replace a screen that explains
 * itself with a blank one that doesn't.
 */
function reloadForNewBuild(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (sessionGet(RELOAD_KEY)) return false;
  sessionSet(RELOAD_KEY, '1');
  window.location.reload();
  return true;
}

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number;
  /** Base pause between tries; each retry waits a further multiple of it. */
  delayMs?: number;
  /** Called once the tries are spent, before the error is rethrown. Returns true
   *  if it has started a recovery of its own. */
  onExhausted?: () => boolean;
}

/**
 * Runs `load`, retrying a few times with a widening pause.
 *
 * Split out from `lazyChunk` and free of React so the retrying is testable on
 * its own — the interesting behaviour is entirely in here.
 */
export async function loadWithRetry<T>(load: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, delayMs = 400, onExhausted = reloadForNewBuild } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const loaded = await load();
      // Something loaded, so whatever was wrong is over: let a *future* stale
      // build spend its one reload rather than inherit this session's.
      sessionClear(RELOAD_KEY);
      return loaded;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }

  onExhausted();
  throw lastError;
}

/**
 * `React.lazy` with the retrying above wrapped around the import. Drop-in: the
 * result is used exactly like a lazy component.
 */
// The `any` mirrors React's own `lazy` signature. Narrowing it here would only
// reject components that take props — which is most of the drawers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyChunk<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => loadWithRetry(load));
}
