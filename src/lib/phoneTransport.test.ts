/**
 * The device identity, on the origin the phone actually gets the app from.
 *
 * The Wi-Fi bridge serves over plain http to a LAN address, which is not a
 * secure context — so the half of the crypto API that is gated on one simply
 * isn't there. That is not an exotic case: it is the normal way this app
 * reaches a phone, and identity() is on the path that sets up all syncing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { identity, httpBridge, compositeBridge, syncFetch, type SyncBridge } from './phoneTransport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = globalThis.crypto;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true }); });

/** Replace the global crypto with one exposing only the listed members. */
function cryptoWith(members: Partial<Crypto>) {
  Object.defineProperty(globalThis, 'crypto', { value: members, configurable: true });
}

describe('minting a device id', () => {
  it('uses randomUUID where there is one', () => {
    cryptoWith({ randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(identity().deviceId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('still mints one over the Wi-Fi bridge, where randomUUID is not defined', () => {
    cryptoWith({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    const id = identity().deviceId;
    expect(id).toMatch(UUID);
  });

  it('mints something usable even with no crypto at all', () => {
    cryptoWith({});
    expect(identity().deviceId.length).toBeGreaterThan(8);
  });

  it('keeps the same id across calls — a new one each launch would look like a new device', () => {
    cryptoWith({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    const first = identity().deviceId;
    expect(identity().deviceId).toBe(first);
  });

  it('does not throw where the old code did', () => {
    cryptoWith({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    // The precise failure this guards: calling the gated member directly.
    expect(() => (globalThis.crypto as Crypto).randomUUID()).toThrow();
    expect(() => identity()).not.toThrow();
  });

  it('repairs corrupt saved identity instead of sharing a generic phone id', () => {
    localStorage.setItem('milestone-phone-device', '{bad');
    expect(identity().deviceId).not.toBe('phone');
    expect(identity().deviceId).toBe(identity().deviceId);
  });
});

const route = (enabled: boolean): SyncBridge => ({
  getConfig: async () => ({ enabled, folder: '', deviceId: 'desktop', deviceName: 'Desktop' }),
  readPeers: async () => ({ ok: true, peers: [] }), write: async () => ({ ok: true }),
  writeBackup: async () => ({ ok: true }), onChanged: () => () => {},
});

it('a relay enables publishing even when desktop folder sync is off', async () => {
  expect((await compositeBridge([route(false), route(true)]).getConfig()).enabled).toBe(true);
});

it('partial delivery stays pending rather than reporting all devices synced', async () => {
  const offline = { ...route(true), write: async () => ({ ok: false }) };
  expect((await compositeBridge([route(true), offline]).write({})).ok).toBe(false);
});

describe('recovery copies on every route', () => {
  it('sends a backup to every route, and succeeds if any of them kept it', async () => {
    const folder = vi.fn(async () => ({ ok: true }));
    const relay = vi.fn(async () => ({ ok: false, error: 'offline' }));
    const both = compositeBridge([{ ...route(true), writeBackup: folder }, { ...route(true), writeBackup: relay }]);
    expect((await both.writeBackup('checkpoint-x.json', { _milestone: 2 })).ok).toBe(true);
    expect(folder).toHaveBeenCalledTimes(1);
    expect(relay).toHaveBeenCalledTimes(1);
    const none = compositeBridge([{ ...route(true), writeBackup: relay }]);
    expect((await none.writeBackup('checkpoint-x.json', { _milestone: 2 })).ok).toBe(false);
  });

  it('lists backups from every route once, newest first, and reads each from whichever route has it', async () => {
    const both = compositeBridge([
      { ...route(true), readBackups: async () => [{ name: 'a.json', saved: 1 }, { name: 'c.json', saved: 3 }], readBackup: async (name: string) => name === 'a.json' ? { from: 'folder' } : null },
      { ...route(true), readBackups: async () => { throw new Error('offline'); }, readBackup: async () => ({ from: 'relay' }) },
      { ...route(true), readBackups: async () => [{ name: 'a.json', saved: 1 }, { name: 'b.json', saved: 2 }] },
    ]);
    expect((await both.readBackups!()).map(entry => entry.name)).toEqual(['c.json', 'b.json', 'a.json']);
    expect(await both.readBackup!('a.json')).toEqual({ from: 'folder' });
    expect(await both.readBackup!('b.json')).toEqual({ from: 'relay' });
  });

  it('reads the relay\'s backup list and bundles', async () => {
    const fetch = vi.fn(async (input: string) => ({
      ok: true, status: 200,
      json: async () => input.includes('/api/backups')
        ? { ok: true, backups: [{ id: 'backup:checkpoint-x.json', saved: 5 }, { id: 'device:phone', saved: 6 }, { id: 'backup:bad', saved: 'x' }] }
        : { ok: true, bundle: { _milestone: 2 } },
    }));
    vi.stubGlobal('fetch', fetch);
    const relay = httpBridge({ base: 'https://relay.example', token: 'synthetic', me: { deviceId: 'phone', deviceName: 'Phone' } });
    expect(await relay.readBackups!()).toEqual([{ name: 'checkpoint-x.json', saved: 5 }]);
    expect(await relay.readBackup!('checkpoint-x.json')).toEqual({ _milestone: 2 });
    expect(String(fetch.mock.lastCall![0])).toContain('name=checkpoint-x.json');
  });
});

it('all routes throwing is a read failure, not a successful empty peer list', async () => {
  const broken = { ...route(true), readPeers: async () => { throw new Error('offline'); } };
  expect((await compositeBridge([broken]).readPeers()).ok).toBe(false);
});

it('network requests time out instead of blocking the sync queue forever', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('timeout')));
  })));
  const request = expect(syncFetch('https://synthetic.test/api/health')).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(10_000);
  await request;
  vi.useRealTimers();
});

it('shares one event stream between subscribers and releases it after the last unsubscribe', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ app: 'milestone' }) }));
  const close = vi.fn();
  const streams = vi.fn();
  class Stream { constructor() { streams(); } addEventListener = vi.fn(); close = close; }
  vi.stubGlobal('EventSource', Stream);
  const bridge = httpBridge({ token: 'synthetic', me: { deviceId: 'desktop', deviceName: 'Desktop' } });
  const offA = bridge.onChanged(() => {});
  const offB = bridge.onChanged(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(streams).toHaveBeenCalledOnce();
  offA(); expect(close).not.toHaveBeenCalled();
  offB(); expect(close).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

describe('live relay notifications', () => {
  it('uses at most 290 HTTP requests per idle day with push connected and reuses notification reads', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, peers: [], push: 'websocket' }) });
    vi.stubGlobal('fetch', fetcher);
    let socket!: Socket;
    class Socket {
      static CLOSED = 3;
      readyState = 1;
      onopen = () => {};
      close = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      constructor() { socket = this; }
    }
    vi.stubGlobal('WebSocket', Socket);
    const bridge = httpBridge({ base: 'https://relay.example', token: 'synthetic', me: { deviceId: 'phone', deviceName: 'Phone' } });
    const off = bridge.onChanged(() => { void bridge.readPeers(); });
    try {
      await vi.advanceTimersByTimeAsync(0);
      socket.onopen();
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(290);
      expect(fetcher.mock.calls.length).toBeGreaterThan(280);
    } finally { off(); vi.useRealTimers(); }
  });

  it('pulls immediately on reconnect and polls promptly when a desktop stream fails', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, peers: [{ deviceId: 'phone', updatedAt: '1' }] }) });
    vi.stubGlobal('fetch', fetcher);
    let stream!: FakeStream;
    class FakeStream {
      onopen = () => {};
      onerror = () => {};
      addEventListener = vi.fn();
      close = vi.fn();
      // Test harness captures the fake browser instance to simulate SSE events.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      constructor() { stream = this; }
    }
    vi.stubGlobal('EventSource', FakeStream);
    const changed = vi.fn();
    const off = httpBridge({ token: 'test', me: { deviceId: 'desktop', deviceName: 'Desktop' }, poll: false }).onChanged(changed);
    try {
      await vi.advanceTimersByTimeAsync(0);
      stream.onopen();
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toHaveBeenCalledOnce();
      stream.onerror();
      fetcher.mockResolvedValue({ json: async () => ({ ok: true, peers: [{ deviceId: 'phone', updatedAt: '2' }] }) });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(changed).toHaveBeenCalledTimes(2);
      off();
      await vi.advanceTimersByTimeAsync(30000);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(stream.close).toHaveBeenCalledOnce();
    } finally { off(); vi.useRealTimers(); }
  });
});
