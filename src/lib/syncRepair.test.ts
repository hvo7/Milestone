/**
 * Sync repair batch: Life Vitals travels, one bad device cannot stop the rest,
 * a clock that went backwards is recovered, and every document says which build
 * wrote it.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SyncDoc } from './cloudSync';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; delete window.electronAPI; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const VITALS_KEY = 'milestone-status-vitals-v1';
const area = (name: string) => ({ id: name.toLowerCase(), name, icon: 'gym', onPace: 'Three sessions a week', entries: [] });
const vitalsSlot = (...names: string[]) => JSON.stringify({ state: { areas: names.map(area) }, version: 0 });
const peerDoc = (extra: Partial<SyncDoc>): SyncDoc => ({ _milestoneSync: 1, deviceId: 'laptop', deviceName: 'Laptop',
  updatedAt: new Date().toISOString(), clock: { laptop: 1 }, stores: {}, ...extra });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mocks are typed by the document they receive
async function setup(bridge: Record<string, any> = {}, before?: () => void) {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
  before?.();
  const peers: unknown[] = [];
  const write = vi.fn<(doc: SyncDoc) => Promise<{ ok: boolean; error?: string; stale?: boolean }>>().mockResolvedValue({ ok: true });
  const backup = vi.fn().mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'synthetic', deviceId: 'desktop', deviceName: 'Desktop' }),
    readPeers: async () => ({ ok: true, peers }), write, writeBackup: backup, onChanged: () => () => {}, ...bridge,
  } } });
  const sync = await import('./cloudSync');
  stop = sync.stopCloudSync;
  const { useQuestStore: store } = await import('../store');
  store.setState({ routines: [], questlines: [] });
  await sync.startCloudSync();
  return { sync, store, peers, write, backup };
}

it('publishes Life Vitals, stamps the build, and republishes when a check-in is saved', async () => {
  const { write } = await setup({}, () => localStorage.setItem(VITALS_KEY, JSON.stringify([area('Gym')])));
  const first = write.mock.lastCall![0];
  expect(first.stores.vitals).toBe(vitalsSlot('Gym'));
  expect(first.slotClocks!.vitals).toEqual({ desktop: 1 });
  expect(first.appVersion).toMatch(/^\d+\.\d+\.\d+/);

  const { noteVitalsChanged } = await import('./vitalsSync');
  localStorage.setItem(VITALS_KEY, JSON.stringify([area('Gym'), area('School')]));
  noteVitalsChanged();
  await vi.advanceTimersByTimeAsync(800);
  const second = write.mock.lastCall![0];
  expect(second.stores.vitals).toBe(vitalsSlot('Gym', 'School'));
  expect(second.slotClocks!.vitals).toEqual({ desktop: 2 });
  // Nothing else moved.
  expect(second.slotClocks!.quest).toEqual(first.slotClocks!.quest);
});

it('adopts another device\'s Life Vitals into storage and tells an open page', async () => {
  const { sync, peers, backup } = await setup();
  const { VITALS_SYNCED } = await import('./vitalsSync');
  const heard = vi.fn();
  window.addEventListener(VITALS_SYNCED, heard);
  peers.push(peerDoc({ slotClocks: { vitals: { laptop: 1 } }, stores: { vitals: vitalsSlot('Wellbeing') } }));
  await sync.syncNow();
  window.removeEventListener(VITALS_SYNCED, heard);
  expect(JSON.parse(localStorage.getItem(VITALS_KEY)!)).toEqual([area('Wellbeing')]);
  expect(heard).toHaveBeenCalledOnce();
  // Nothing local was replaced, so no conflict backup was needed.
  expect(backup).not.toHaveBeenCalled();
});

it('never publishes an empty Life Vitals list, so an unused device cannot overwrite real check-ins', async () => {
  const { write } = await setup({}, () => localStorage.setItem(VITALS_KEY, '[]'));
  expect(write.mock.lastCall![0].stores.vitals).toBeUndefined();
  expect(write.mock.lastCall![0].slotClocks!.vitals).toEqual({});
});

it('keeps local Life Vitals that an older build\'s copy lacks, and adds the ones it has', async () => {
  const { sync, peers, backup } = await setup({}, () => localStorage.setItem(VITALS_KEY, JSON.stringify([area('Gym')])));
  // A 3.4.1 laptop that saw this desktop's first publish and kept its own copy.
  peers.push(peerDoc({ clock: { laptop: 1, desktop: 1 }, slotClocks: { vitals: { laptop: 1, desktop: 1 } }, stores: { vitals: vitalsSlot('Work') } }));
  await sync.syncNow();
  // An older build can add, never delete: its whole-copy conflict handling may be stale.
  expect(JSON.parse(localStorage.getItem(VITALS_KEY)!).map((a: { name: string }) => a.name)).toEqual(['Gym', 'Work']);
  expect(backup).not.toHaveBeenCalled();
});

it('rejects a malformed Life Vitals slot without touching local areas', async () => {
  const { sync, peers } = await setup({}, () => localStorage.setItem(VITALS_KEY, JSON.stringify([area('Gym')])));
  peers.push(peerDoc({ slotClocks: { vitals: { laptop: 5, desktop: 1 } }, stores: { vitals: JSON.stringify({ state: { areas: [{ id: 1 }] } }) } }));
  await sync.syncNow();
  expect(JSON.parse(localStorage.getItem(VITALS_KEY)!)).toEqual([area('Gym')]);
});

it('keeps syncing with good devices when one sends unreadable data, and names it', async () => {
  const { sync, store, peers } = await setup();
  peers.push({ _milestoneSync: 1, deviceId: 'old phone', deviceName: 'Old phone', updatedAt: 'not a date', clock: {}, stores: {} });
  peers.push(peerDoc({ stores: { quest: JSON.stringify({ state: { routines: [], questlines: [{ id: 'from-laptop', title: 'Laptop', quests: [] }] }, version: 0 }) } }));
  await sync.syncNow();
  expect(store.getState().questlines[0]?.id).toBe('from-laptop');
  const status = sync.useSyncStatus.getState();
  expect(status.warning).toContain('Old phone');
  expect(status.error).toBeNull();
  expect(status.peers.map(p => p.deviceName)).toEqual(['Laptop']);
});

it('reports each peer\'s build so an out-of-date device is visible', async () => {
  const { sync, peers } = await setup();
  peers.push(peerDoc({ appVersion: '3.3.10' }), peerDoc({ deviceId: 'phone', deviceName: 'Phone', clock: { phone: 1 } }));
  await sync.syncNow();
  expect(sync.useSyncStatus.getState().peers).toEqual([
    expect.objectContaining({ deviceName: 'Laptop', appVersion: '3.3.10' }),
    expect.objectContaining({ deviceName: 'Phone', appVersion: undefined }),
  ]);
});

it('recovers when the relay refuses a write because this device\'s clock went backwards', async () => {
  // The relay remembers this device at quest:7. Local bookkeeping was lost.
  const remembered: SyncDoc = { _milestoneSync: 1, deviceId: 'desktop', deviceName: 'Desktop', updatedAt: '2026-11-20T00:00:00Z',
    clock: { desktop: 7, laptop: 3 }, slotClocks: { quest: { desktop: 7, laptop: 3 }, vynues: { desktop: 2 }, ui: { desktop: 4 } }, stores: {} };
  const accepts = (doc: SyncDoc) => Object.entries(remembered.clock).every(([id, n]) => (doc.clock[id] ?? 0) >= n);
  const write = vi.fn(async (doc: SyncDoc) => accepts(doc) ? { ok: true } : { ok: false, stale: true, error: 'This device sent an older snapshot. Reconnect before retrying.' });
  const readSelf = vi.fn(async () => remembered);
  const { sync } = await setup({ write, readSelf });
  expect(readSelf).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledTimes(2);
  const sent = write.mock.lastCall![0];
  expect(sent.slotClocks!.quest).toEqual({ desktop: 7, laptop: 3 });
  expect(sent.clock.desktop).toBe(7);
  const status = sync.useSyncStatus.getState();
  expect(status.error).toBeNull();
  expect(status.notice).toContain('repaired');
  // And it stays repaired: the next edit goes straight through.
  const { useQuestStore } = await import('../store');
  useQuestStore.setState({ routines: [], questlines: [{ id: 'after', title: 'After', description: '', icon: '', color: 'sapphire', quests: [], createdAt: '2026-11-23T00:00:00Z' }] });
  await vi.advanceTimersByTimeAsync(800);
  expect(write.mock.lastCall![0].slotClocks!.quest).toEqual({ desktop: 8, laptop: 3 });
  expect(readSelf).toHaveBeenCalledOnce();
});

it('leaves a refused write pending when the route cannot return this device\'s own document', async () => {
  const write = vi.fn(async () => ({ ok: false, stale: true, error: 'This device sent an older snapshot. Reconnect before retrying.' }));
  const { sync } = await setup({ write, readSelf: async () => null });
  expect(write).toHaveBeenCalledOnce();
  expect(sync.useSyncStatus.getState().error).toContain('older snapshot');
});

it('marks a 409 "older snapshot" as stale over HTTP and can read this device\'s own document back', async () => {
  vi.resetModules(); localStorage.clear();
  const mine = { deviceId: 'me-1', clock: { 'me-1': 4 } };
  const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ ok: false, error: 'This device sent an older snapshot. Reconnect before retrying.' }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, peers: [{ deviceId: 'other' }, mine] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { httpBridge, compositeBridge } = await import('./phoneTransport');
  const bridge = compositeBridge([httpBridge({ base: 'https://relay.example', token: 'k'.repeat(32), me: { deviceId: 'me-1', deviceName: 'Phone' } })]);
  expect(await bridge.write({})).toMatchObject({ ok: false, stale: true });
  expect(await bridge.readSelf!()).toEqual(mine);
  // Asked as nobody, so the relay does not filter this device out.
  expect(String(fetchMock.mock.lastCall![0])).toContain('deviceId=-');
});
