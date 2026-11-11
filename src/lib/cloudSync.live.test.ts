import { afterEach, expect, it, vi } from 'vitest';
import type { SyncDoc } from './cloudSync';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; delete window.electronAPI; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('applies a phone push to the live desktop store without refreshing the page', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  let changed = () => {};
  let peers: unknown[] = [];
  const write = vi.fn(async () => ({ ok: true }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'test', deviceId: 'desktop', deviceName: 'Desktop' }),
    readPeers: async () => ({ ok: true, peers }),
    write, writeBackup: async () => ({ ok: true }),
    onChanged: (fn: () => void) => { changed = fn; return () => {}; },
  } } });
  const { startCloudSync, syncNow, stopCloudSync } = await import('./cloudSync');
  stop = stopCloudSync;
  const { useQuestStore } = await import('../store');
  useQuestStore.setState({ routines: [], questlines: [] });
  await startCloudSync();
  peers = [{ _milestoneSync: 1, deviceId: 'phone', deviceName: 'Phone', updatedAt: new Date().toISOString(),
    clock: { phone: 1 }, stores: { quest: JSON.stringify({ state: { questlines: [{ id: 'from-phone', title: 'Phone change', quests: [] }], routines: [] }, version: 0 }) } }];
  changed();
  await syncNow();
  expect(useQuestStore.getState().questlines[0].id).toBe('from-phone');
  expect(write).toHaveBeenCalled();
  delete window.electronAPI;
});

async function setup() {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
  const peers: SyncDoc[] = [];
  const write = vi.fn<(doc: SyncDoc) => Promise<{ ok: boolean; error?: string }>>().mockResolvedValue({ ok: true });
  const backup = vi.fn().mockResolvedValue({ ok: true });
  const off = vi.fn();
  const onChanged = vi.fn(() => off);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'synthetic', deviceId: 'desktop', deviceName: 'Desktop' }),
    readPeers: async () => ({ ok: true, peers }), write, writeBackup: backup, onChanged,
  } } });
  const sync = await import('./cloudSync');
  stop = sync.stopCloudSync;
  const { useQuestStore: store } = await import('../store');
  store.setState({ routines: [], questlines: [] });
  await sync.startCloudSync();
  return { sync, store, peers, write, backup, off, onChanged };
}

it('publishes initial desktop data with a nonzero clock so a fresh mobile can adopt it', async () => {
  const { write } = await setup();
  expect(write.mock.lastCall![0].slotClocks!.quest!.desktop).toBe(1);
});

it('adopts an existing peer when first-run bookkeeping fires during the initial network read', async () => {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
  let resolveRead!: (result: { ok: boolean; peers: SyncDoc[] }) => void;
  const write = vi.fn(async () => ({ ok: true }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'synthetic', deviceId: 'fresh', deviceName: 'Fresh' }),
    readPeers: () => new Promise(resolve => { resolveRead = resolve; }),
    write, writeBackup: async () => ({ ok: true }), onChanged: () => () => {},
  } } });
  const sync = await import('./cloudSync'); stop = sync.stopCloudSync;
  const { useQuestStore: store } = await import('../store');
  store.setState({ routines: [], questlines: [] });
  const started = sync.startCloudSync();
  await vi.advanceTimersByTimeAsync(0);
  store.setState({ routines: [], questlines: [] });
  resolveRead({ ok: true, peers: [{ _milestoneSync: 1, deviceId: 'desktop', deviceName: 'Desktop',
    updatedAt: '2026-10-18T00:00:00Z', clock: { desktop: 1 },
    stores: { quest: JSON.stringify({ state: { routines: [], questlines: [{ id: 'saved', title: 'Saved desktop quest', quests: [] }] } }) } }] });
  await started;
  expect(store.getState().questlines[0]?.id).toBe('saved');
  expect(write).toHaveBeenCalledOnce();
});

it('uploads local edits after the debounce and retries a failed write without another edit', async () => {
  const { store, write, sync, peers } = await setup();
  peers.push({ ...write.mock.lastCall![0], deviceId: 'phone', deviceName: 'Phone' });
  write.mockResolvedValue({ ok: false, error: 'Offline' });
  store.setState({ routines: [], questlines: [{ id: 'desktop-edit', title: 'New desktop task', description: '', icon: '', color: '#369', quests: [] }] });
  await vi.advanceTimersByTimeAsync(700);
  expect(sync.useSyncStatus.getState().error).toBe('Offline');
  const version = write.mock.lastCall![0].slotClocks!.quest;
  // The peer already knows this clock; only the pending outbox forces retry.
  peers[0] = { ...write.mock.lastCall![0], deviceId: 'phone' };
  write.mockResolvedValue({ ok: true });
  window.dispatchEvent(new Event('online'));
  await sync.syncNow();
  expect(write.mock.lastCall![0].slotClocks!.quest).toEqual(version);
  expect(sync.useSyncStatus.getState().error).toBeNull();
  expect(JSON.parse(localStorage.getItem('milestone-sync-meta')!).pending).toBe(false);
});

it('cleans old watchers when reconnecting instead of multiplying subscriptions', async () => {
  const { sync, off, onChanged, write, store } = await setup();
  await sync.reconnectCloudSync();
  expect(off).toHaveBeenCalledOnce();
  expect(onChanged).toHaveBeenCalledTimes(2);
  write.mockClear();
  store.setState({ routines: [], questlines: [] });
  await vi.advanceTimersByTimeAsync(700);
  expect(write).not.toHaveBeenCalled(); // Reassigning identical data needs no upload.
});

it('ignores malformed remote state without corrupting local storage', async () => {
  const { sync, peers, write, store } = await setup();
  peers.push({ ...write.mock.lastCall![0], deviceId: 'phone', clock: { phone: 99 }, slotClocks: undefined,
    stores: { quest: '{broken' } });
  await sync.syncNow();
  expect(store.getState().questlines).toEqual([]);
  expect(typeof store.getState().addQuest).toBe('function');
});

it('does not discard local changes when a conflict backup fails', async () => {
  const { sync, peers, write, backup, store } = await setup();
  peers.push({ ...write.mock.lastCall![0], deviceId: 'phone', clock: { phone: 1 }, slotClocks: undefined,
    updatedAt: '2099-01-01T00:00:00.000Z', slotVersions: undefined,
    stores: { quest: JSON.stringify({ state: { questlines: [{ id: 'peer', title: 'Peer', quests: [] }], routines: [] } }) } });
  backup.mockResolvedValue({ ok: false });
  await sync.syncNow();
  expect(store.getState().questlines).toEqual([]);
  expect(sync.useSyncStatus.getState().error).toContain('backup');
  backup.mockResolvedValue({ ok: true });
  await sync.syncNow();
  expect(store.getState().questlines[0].id).toBe('peer');
});

it('keeps the newer local edit on a concurrent peer push and backs up both copies', async () => {
  const { sync, peers, write, backup, store } = await setup();
  peers.push({ ...write.mock.lastCall![0], deviceId: 'phone', clock: { phone: 1 }, slotClocks: undefined,
    updatedAt: '2001-01-01T00:00:00.000Z', slotVersions: undefined,
    stores: { quest: JSON.stringify({ state: { questlines: [{ id: 'peer', title: 'Older peer', quests: [] }], routines: [] } }) } });
  await sync.syncNow();
  expect(store.getState().questlines).toEqual([]);
  expect(backup).toHaveBeenCalledTimes(2);
  expect(write.mock.lastCall![0].slotClocks!.quest).toEqual({ desktop: 1, phone: 1 });
});

it('restores a paired mobile transport when launched offline and receives desktop data on reconnect', async () => {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); delete window.electronAPI;
  localStorage.setItem('milestone-phone-token', 'synthetic');
  const fetcher = vi.fn().mockRejectedValue(new Error('Offline'));
  vi.stubGlobal('fetch', fetcher);
  const sync = await import('./cloudSync'); stop = sync.stopCloudSync;
  const { useQuestStore: store } = await import('../store');
  store.setState({ routines: [], questlines: [] });
  await sync.startCloudSync();
  expect(sync.useSyncStatus.getState().enabled).toBe(true);
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === 'POST' ? { ok: true } : {
    ok: true, peers: [{ _milestoneSync: 1, deviceId: 'desktop', deviceName: 'Desktop', updatedAt: new Date().toISOString(), clock: { desktop: 5 },
      stores: { quest: JSON.stringify({ state: { routines: [], questlines: [{ id: 'desktop', title: 'From desktop', quests: [] }] } }) } }],
  } }));
  window.dispatchEvent(new Event('online'));
  await sync.syncNow();
  expect(store.getState().questlines[0].id).toBe('desktop');
});

it('uses the key entered inside an installed iPhone app for a same-origin relay', async () => {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); delete window.electronAPI;
  localStorage.setItem('milestone-relay', JSON.stringify({ url: location.origin, token: 'new-pairing-key' }));
  localStorage.setItem('milestone-phone-token', 'obsolete-safari-key');
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ ok: true, app: 'milestone', peers: [] }) });
  vi.stubGlobal('fetch', fetcher);
  const sync = await import('./cloudSync'); stop = sync.stopCloudSync;
  await sync.startCloudSync();
  const peerCalls = fetcher.mock.calls.filter(([url]) => String(url).includes('api/peers'));
  expect(peerCalls.length).toBeGreaterThan(0);
  expect(peerCalls.every(([url]) => String(url).includes('t=new-pairing-key'))).toBe(true);
});
