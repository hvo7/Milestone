import { afterEach, expect, it, vi } from 'vitest';
import { watchSyncPush } from './syncPush';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses secure WebSockets, signals changes, reconnects, and cleans up', async () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static CLOSED = 3;
    readyState = 1;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    close = vi.fn();
    url: string;
    constructor(url: string) { this.url = url; sockets.push(this); }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  const changed = vi.fn(), connected = vi.fn();
  const stop = watchSyncPush({ health: async () => ({ push: 'websocket' }),
    eventsUrl: 'https://private.example/api/events?t=synthetic&deviceId=phone', changed, connected });
  await vi.advanceTimersByTimeAsync(0);
  expect(sockets[0].url).toContain('wss://private.example/');
  sockets[0].onopen!();
  sockets[0].onmessage!({ data: '{"type":"changed"}' });
  expect(changed).toHaveBeenCalledTimes(2);
  sockets[0].onclose!();
  expect(connected).toHaveBeenLastCalledWith(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets).toHaveLength(2);
  stop();
  expect(sockets[1].close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);
  expect(sockets).toHaveLength(2);
});

it('does not open a late connection after unsubscribing during capability discovery', async () => {
  let finish!: (value: { push: string }) => void;
  const socket = vi.fn(); vi.stubGlobal('WebSocket', socket);
  const stop = watchSyncPush({ health: () => new Promise(resolve => { finish = resolve; }),
    eventsUrl: 'https://private.example/api/events', changed: vi.fn(), connected: vi.fn() });
  stop(); finish({ push: 'websocket' });
  await Promise.resolve(); await Promise.resolve();
  expect(socket).not.toHaveBeenCalled();
});

it('retries capability discovery after an offline launch', async () => {
  vi.useFakeTimers();
  const health = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ push: 'websocket' });
  const created = vi.fn();
  class Socket { constructor() { created(); } close = vi.fn(); }
  vi.stubGlobal('WebSocket', Socket);
  const stop = watchSyncPush({ health, eventsUrl: 'https://private.example/api/events', changed: vi.fn(), connected: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(created).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(created).toHaveBeenCalledOnce();
  stop();
});
