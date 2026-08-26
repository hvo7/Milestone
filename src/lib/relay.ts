/**
 * The always-on meeting point, for when the two devices are never awake at the
 * same time.
 *
 * The Wi-Fi bridge only works while you're standing next to the computer. A
 * relay is the same protocol at an address that is always up, so an edit made on
 * a train is waiting for the desktop whenever it next looks — and the desktop's
 * edits are waiting for the phone.
 *
 * What it stores is what the cloud folder stores: one small document per device,
 * each device writing only its own. The relay never merges anything and has no
 * idea what a task is; the reconciliation still happens on the devices. That
 * keeps the thing you have to trust small — it holds your data, but it cannot
 * quietly decide what your data is.
 *
 * Where it runs is your choice; server/relay.mjs is the whole implementation.
 */
const KEY = 'milestone-relay';

export interface RelayConfig {
  /** Base URL, e.g. https://milestone.fly.dev. Empty when not set up. */
  url: string;
  /** The shared key, matching MILESTONE_TOKEN where the relay runs. */
  token: string;
}

export const emptyRelay = (): RelayConfig => ({ url: '', token: '' });

/** Deliberately *not* in a synced store: it is how this device reaches the
 *  others, and syncing it would be a loop. */
export function loadRelay(): RelayConfig {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.url === 'string' && typeof parsed.token === 'string') return parsed;
  } catch { /* corrupt config reads as "not set up" */ }
  return emptyRelay();
}

export function saveRelay(config: RelayConfig): RelayConfig {
  const clean: RelayConfig = { url: config.url.trim().replace(/\/+$/, ''), token: config.token.trim() };
  localStorage.setItem(KEY, JSON.stringify(clean));
  return clean;
}

export const relayConfigured = (config: RelayConfig = loadRelay()): boolean => !!config.url && !!config.token;

/** Does this address answer, and with the right key? Used by the settings card,
 *  so a typo is caught while you're looking at it rather than silently never
 *  syncing. */
export async function testRelay(config: RelayConfig): Promise<{ ok: boolean; error?: string }> {
  const base = config.url.trim().replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'No address.' };
  try {
    const health = await fetch(`${base}/api/health`, { cache: 'no-store' });
    if (!health.ok) return { ok: false, error: `The address answered ${health.status}.` };
    const body = await health.json();
    if (body?.app !== 'milestone') return { ok: false, error: 'That address is not a Milestone relay.' };

    const peers = await fetch(`${base}/api/peers?t=${encodeURIComponent(config.token.trim())}`, { cache: 'no-store' });
    if (peers.status === 401) return { ok: false, error: 'The key does not match the one on the relay.' };
    if (!peers.ok) return { ok: false, error: `The relay answered ${peers.status}.` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach it.' };
  }
}
