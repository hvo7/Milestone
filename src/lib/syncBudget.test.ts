import { afterEach, expect, it, vi } from 'vitest';
import { reserveSyncRequest } from './syncBudget';

afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

it('shares a rolling burst limit between HTTP and WebSocket connections', () => {
  localStorage.clear(); vi.useFakeTimers();
  for (let i = 0; i < 15; i++) {
    reserveSyncRequest('https://relay.example/api/peers');
    reserveSyncRequest('wss://relay.example/api/events');
  }
  expect(() => reserveSyncRequest('https://relay.example/api/write')).toThrow('slowing down');
  vi.advanceTimersByTime(60_000);
  expect(() => reserveSyncRequest('https://relay.example/api/write')).not.toThrow();
});

it('keeps the daily budget across reloads and resets at midnight UTC', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T23:59:00Z'));
  localStorage.setItem('milestone-request-budget:https://relay.example', JSON.stringify({ day: '2026-10-19', count: 7999, recent: [] }));
  reserveSyncRequest('https://relay.example/api/write');
  vi.resetModules();
  const reloaded = await import('./syncBudget');
  expect(() => reloaded.reserveSyncRequest('https://relay.example/api/peers')).toThrow('daily allowance');
  vi.advanceTimersByTime(60_000);
  expect(() => reloaded.reserveSyncRequest('https://relay.example/api/peers')).not.toThrow();
});
