/**
 * Document exchange over HTTP — the transport the phone uses, and the one the
 * desktop uses to reach a relay.
 *
 * Two places speak this protocol, and they are the same protocol on purpose:
 *
 *   • the desktop itself, serving the app on your Wi-Fi (electron/phone.cjs)
 *   • a relay you run somewhere always-on (server/relay.mjs)
 *
 * Either way it adapts to the shape cloudSync.ts already talks to, so the phone
 * runs the identical reconciler — per-slot vector clocks, fast-forwards, conflict
 * backups. Writing a second sync would mean two chances to lose data and
 * attention on only one of them.
 *
 * ── Being away from the desktop ─────────────────────────────────────────────
 * Nothing here is required for the app to *work*. The phone holds the whole
 * profile in its own storage and the service worker serves the app offline, so
 * it runs with no network at all. This layer only decides when the two copies
 * find out about each other: over Wi-Fi if the desktop is up, through the relay
 * otherwise, and — when neither is reachable — on the next attempt, because a
 * document is regenerated from current state each time rather than queued.
 */

/** Same surface as `window.electronAPI.sync`, so cloudSync can't tell them apart. */
import { watchSyncPush } from './syncPush';
import { reserveSyncRequest } from './syncBudget';

export interface SyncBridge {
  getConfig: () => Promise<{ enabled: boolean; folderEnabled?: boolean; folder: string; deviceId: string; deviceName: string; sharedRelay?: { url: string; token: string } }>;
  readPeers: () => Promise<{ ok: boolean; peers?: unknown[]; error?: string }>;
  write: (doc: unknown) => Promise<{ ok: boolean; at?: string; error?: string }>;
  writeBackup: (name: string, bundle: unknown) => Promise<{ ok: boolean; error?: string }>;
  onChanged: (callback: () => void) => () => void;
}

const TOKEN_KEY = 'milestone-phone-token';
const DEVICE_KEY = 'milestone-phone-device';

/**
 * How often a device asks what changed.
 *
 * A one-minute fallback covers unavailable or reconnecting event streams.
 */
const POLL_MS = 60_000;

/**
 * How often to ask when the endpoint is *pushing* changes as they happen.
 *
 * With the event stream up (see `openStream` in electron/phone.cjs and
 * server/relay.mjs) the poll is no longer how anything is discovered — it is
 * the backstop for the one case the stream cannot cover: an event that arrived
 * while the socket was down and the reconnect missed. Rare enough to check
 * lazily, and every one of these on a phone is battery and radio.
 */
const SLOW_POLL_MS = 300_000;

/** Bound every request so an unreachable route cannot stall all other routes. */
export async function syncFetch(input: string, init: RequestInit = {}): Promise<Pick<Response, 'ok' | 'status' | 'json'>> {
  reserveSyncRequest(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Include body delivery in the timeout, not just the response headers.
    const body = await response.json();
    return { ok: response.ok, status: response.status, json: async () => body };
  }
  finally { clearTimeout(timer); }
}

/** The key arrives in the link the desktop shows and is kept, so a device is
 *  paired once — and so a home-screen shortcut with no query string still
 *  works. */
export function rememberToken(): string {
  const fromUrl = new URLSearchParams(location.search).get('t');
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    // Taken back out of the address bar so the key isn't sitting in the title
    // bar, in history, or in a screenshot.
    history.replaceState(null, '', location.pathname + location.hash);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export interface Identity { deviceId: string; deviceName: string }

/**
 * A unique id for this device, on the origins this app is actually served from.
 *
 * `crypto.randomUUID` is only defined in a *secure context* — and the Wi-Fi
 * bridge is `http://192.168.x.x:4785`, which is not one. Calling it there threw
 * `crypto.randomUUID is not a function`, which took `identity()` with it, and
 * with it the whole of `buildTransport()`: the phone that had just been handed
 * the app by the desktop then silently never synced, with nothing on screen to
 * say why. `getRandomValues` carries no such restriction, so it does the work
 * and `randomUUID` is used only when it happens to be there.
 */
function deviceUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;          // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80;          // variant 1
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Nothing left to draw on. Uniqueness only has to hold across your own
  // devices, and this is written once and kept.
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** This device's identity, minted once. It keys this device's entry in every
 *  vector clock, so a new one each launch would look like a new device with no
 *  history and manufacture conflicts. */
export function identity(): Identity {
  let saved = localStorage.getItem(DEVICE_KEY);
  try {
    const value = JSON.parse(saved ?? 'null');
    if (!value || typeof value.deviceId !== 'string' || !/^[\w-]{1,64}$/.test(value.deviceId) || typeof value.deviceName !== 'string') saved = null;
  } catch { saved = null; }
  if (!saved) {
    saved = JSON.stringify({
      deviceId: deviceUuid(),
      deviceName: /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? 'Phone' : 'Browser',
    });
    localStorage.setItem(DEVICE_KEY, saved);
  }
  try {
    return JSON.parse(saved) as Identity;
  } catch {
    return { deviceId: 'phone', deviceName: 'Phone' };
  }
}

/** True when this page was served by something that speaks the protocol — a
 *  Milestone desktop on the network, or the relay. */
export async function servedByMilestone(): Promise<boolean> {
  if (window.electronAPI) return false;             // the desktop app itself
  try {
    const res = await syncFetch('api/health', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.app === 'milestone';
  } catch {
    return false;
  }
}

/**
 * A bridge against one HTTP endpoint.
 *
 * `base` is empty for the origin this page came from, or an absolute URL for a
 * relay the desktop reaches over the internet.
 */
export function httpBridge({ base = '', token, me }: {
  base?: string;
  token: string;
  me: Identity;
  /** Legacy option; all routes now keep a fallback poll for disconnected SSE. */
  poll?: boolean;
}): SyncBridge {
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  /** The peer documents as of the last poll, so a tick that changed nothing
   *  doesn't wake a full reconciliation every few seconds. */
  let lastSeen = '';

  const root = base ? base.replace(/\/+$/, '') + '/' : '';
  const url = (path: string, params: Record<string, string> = {}) =>
    `${root}api/${path}?${new URLSearchParams({ t: token, ...params })}`;

  const post = async (path: string, body: unknown) => {
    try {
      const res = await syncFetch(url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return { ok: false, error: 'This device is not paired — open the link again.' };
      if (res.ok === false) return { ok: false, error: `Sync server returned ${res.status}. Changes remain on this device.` };
      return await res.json();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Not reachable.' };
    }
  };

  const fetchPeers = async () => {
    try {
      const res = await syncFetch(url('peers', { deviceId: me.deviceId }), { cache: 'no-store' });
      if (res.status === 401) return { ok: false, error: 'This device is not paired — open the link again.' };
      if (res.ok === false) return { ok: false, error: `Sync server returned ${res.status}.` };
      return await res.json();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Not reachable.' };
    }
  };

  let ticking = false;
  let tickAgain = false;
  let failed = false;
  let notificationResult: { body: Awaited<ReturnType<typeof fetchPeers>>; at: number } | null = null;
  const tick = async () => {
    if (ticking) { tickAgain = true; return; }
    ticking = true;
    try {
      const body = await fetchPeers();
      if (!body?.ok || !Array.isArray(body.peers)) { failed = true; return; }
      const stamp = JSON.stringify(body.peers.map((p: { deviceId?: string; updatedAt?: string } | null) => [p?.deviceId, p?.updatedAt]).sort());
      if (stamp === lastSeen && !failed) return;
      failed = false;
      lastSeen = stamp;
      notificationResult = { body, at: Date.now() };
      for (const fn of listeners) fn();
    } finally {
      ticking = false;
      if (tickAgain && listeners.size) { tickAgain = false; void tick(); }
    }
  };

  let stopWatching: (() => void) | null = null;

  return {
    // `enabled` is unconditional: having a bridge at all means an endpoint was
    // configured or served this page, which is the whole switch.
    getConfig: async () => ({ enabled: true, folder: '', ...me }),
    readPeers: () => {
      const cached = notificationResult;
      notificationResult = null;
      return cached && Date.now() - cached.at < 1000 ? Promise.resolve(cached.body) : fetchPeers();
    },
    write: doc => post('write', doc),
    writeBackup: (name, bundle) => post('backup', { name, bundle }),

    onChanged: callback => {
      listeners.add(callback);

      if (!stopWatching) {
        const setPoll = (every: number) => {
          if (timer) clearInterval(timer);
          timer = setInterval(() => { void tick(); }, every);
        };
        setPoll(POLL_MS);

        // Push is primary; polling covers lost notifications and blocked streams.
        const stopPush = watchSyncPush({
          health: async () => (await syncFetch(url('health'))).json(),
          eventsUrl: url('events', { deviceId: me.deviceId }),
          changed: () => { void tick(); },
          connected: live => setPoll(live ? SLOW_POLL_MS : POLL_MS),
        });
        const onVisible = () => { if (!document.hidden) void tick(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onVisible);

        stopWatching = () => {
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('online', onVisible);
          stopPush();
          if (timer) { clearInterval(timer); timer = null; }
        };
      }
      return () => {
        listeners.delete(callback);
        if (!listeners.size) { stopWatching?.(); stopWatching = null; }
      };
    },
  };
}

/**
 * One bridge over several.
 *
 * A device can have more than one way to reach its other copies — the desktop
 * has the cloud folder, the Wi-Fi server and possibly a relay; the phone has the
 * relay and, when it's home, the desktop. Reads take the union, writes go
 * everywhere. Partial delivery remains pending until every route acknowledges.
 * The reconciler above is untouched: it still sees a single bridge.
 */
export function compositeBridge(parts: SyncBridge[]): SyncBridge {
  return {
    getConfig: async () => {
      const configs = await Promise.all(parts.map(part => part.getConfig()));
      return { ...configs[0], enabled: configs.some(config => config.enabled) };
    },

    readPeers: async () => {
      const results = await Promise.all(parts.map(p => p.readPeers().catch(() => ({ ok: false } as const))));
      const best = new Map<string, { deviceId: string; updatedAt?: string }>();
      for (const res of results) {
        if (!('peers' in res) || !Array.isArray(res.peers)) continue;
        for (const doc of res.peers as { deviceId: string; updatedAt?: string }[]) {
          if (!doc || typeof doc.deviceId !== 'string') continue;
          const seen = best.get(doc.deviceId);
          // The same peer can arrive by two routes; the fresher copy wins so a
          // stale one can't drag its clock backwards.
          if (!seen || (doc.updatedAt ?? '') > (seen.updatedAt ?? '')) best.set(doc.deviceId, doc);
        }
      }
      const ok = results.some(r => r.ok);
      const errors = results.map(r => ('error' in r ? r.error : null)).filter(Boolean);
      return { ok, peers: [...best.values()], error: ok ? undefined : (errors[0] as string || 'No sync route is reachable.') };
    },

    write: async doc => {
      const results = await Promise.all(parts.map(p => p.write(doc).catch(() => ({ ok: false } as const))));
      const good = results.find(r => r.ok);
      // A local acknowledgement is not delivery to the remote device.
      if (good && results.every(r => r.ok)) return good;
      return { ok: false, error: good ? 'Saved locally; some devices are still waiting. Retrying automatically.' : 'Unable to upload. Changes remain on this device; retrying automatically.' };
    },

    writeBackup: async (name, bundle) => {
      for (const part of parts) {
        const res = await part.writeBackup(name, bundle).catch(() => ({ ok: false } as const));
        if (res.ok) return res;
      }
      return { ok: false, error: 'No route could hold a backup.' };
    },

    onChanged: callback => {
      const offs = parts.map(p => p.onChanged(callback));
      return () => offs.forEach(off => off());
    },
  };
}
