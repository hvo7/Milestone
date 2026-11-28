/**
 * Checkpoints through the real reconciler: one last exchange with the other
 * devices, then the shared state saved on the device and on every route that
 * keeps recovery copies, readable again from any device.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncDoc } from './cloudSync';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; delete window.electronAPI; vi.useRealTimers(); });

type Json = Record<string, unknown>;
const questSlot = (questlines: Json[]) =>
  JSON.stringify({ state: { questlines, routines: [], systems: [], completionLog: {}, taskHistory: {}, todoOrder: {} }, version: 0 });
const ql = (id: string, title: string) => ({ id, title, description: '', icon: '', color: 'sapphire', quests: [] });

const phone = (): SyncDoc => {
  const at = Date.parse('2026-11-27T09:00:00.000Z');
  return {
    _milestoneSync: 1, deviceId: 'phone', deviceName: 'Phone', updatedAt: '2026-11-27T09:00:00.000Z', appVersion: '3.5.2', syncProtocol: 2,
    clock: { phone: 4 }, slotClocks: { quest: { phone: 4 } }, slotVersions: { quest: { at: '2026-11-27T09:00:00.000Z', deviceId: 'phone' } },
    stores: { quest: questSlot([ql('a', 'Shared')]) },
    items: { quest: { s: { '/questlines': ['phone', 4, at, 0], '/questlines/a': ['phone', 4, at, 0] }, t: {} } },
  } as SyncDoc;
};

async function setup({ backupOk = true } = {}) {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
  const peers: unknown[] = [phone()];
  const kept = new Map<string, { name: string; saved: number; bundle: unknown }>();
  const write = vi.fn<(doc: SyncDoc) => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true });
  const writeBackup = vi.fn(async (name: string, bundle: unknown) => {
    if (!backupOk) return { ok: false, error: 'unreachable' };
    kept.set(name, { name, saved: Date.now() + kept.size, bundle });
    return { ok: true };
  });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'synthetic', deviceId: 'laptop', deviceName: 'Laptop' }),
    readPeers: vi.fn(async () => ({ ok: true, peers })), write, writeBackup, onChanged: () => () => {},
    readBackups: async () => [...kept.values()].map(({ name, saved }) => ({ name, saved })).sort((a, b) => b.saved - a.saved),
    readBackup: async (name: string) => kept.get(name)?.bundle ?? null,
  } } });
  const sync = await import('./cloudSync');
  stop = sync.stopCloudSync;
  const { useQuestStore: store } = await import('../store');
  const safety = await import('./syncSafety');
  safety.resetSafetyForTests();
  await sync.startCloudSync();
  // The phone's copy, as it would read once it had taken everything this device sent.
  const phoneCaughtUp = () => peers.splice(0, 1, { ...structuredClone(write.mock.lastCall![0]), deviceId: 'phone', deviceName: 'Phone' });
  return { sync, store, safety, write, writeBackup, kept, phoneCaughtUp };
}

describe('saving a checkpoint', () => {
  it('syncs first, then keeps the shared state on this device and on the relay and cloud folder', async () => {
    const t = await setup();
    t.store.setState({ questlines: [...t.store.getState().questlines, ql('l', 'Made on the laptop')] });

    const result = await t.sync.saveCheckpoint('Before updating from v3.6.0 to v3.6.1');
    // The laptop's new questline went out, but the phone has not read it yet.
    expect(result).toEqual({ synced: true, allInSync: false, shared: true });
    expect((JSON.parse(t.write.mock.lastCall![0].stores.quest!).state.questlines as Json[]).map(q => q.id)).toEqual(['a', 'l']);

    const [name, bundle] = t.writeBackup.mock.lastCall! as [string, Json];
    expect(name).toMatch(/^checkpoint-[\dT-]+Z_v[^_]+_Laptop_Before-updating-from-v3.6.0-to-v3.6.1\.json$/);
    expect(bundle._milestone).toBe(2);
    expect(JSON.parse(bundle.quest as string).state.questlines.map((q: Json) => q.id)).toEqual(['a', 'l']);
    expect(t.sync.describeCheckpoint(name)).toEqual({ device: 'Laptop', version: expect.any(String), reason: 'Before updating from v3.6.0 to v3.6.1' });

    const local = await t.safety.listSafetySnapshots();
    expect(local.map(s => s.reason)).toContain('Before updating from v3.6.0 to v3.6.1');
  });

  it('says every device agreed once the others have caught up, and does not upload the same state twice', async () => {
    const t = await setup();
    t.store.setState({ questlines: [...t.store.getState().questlines, ql('l', 'Made on the laptop')] });
    await t.sync.saveCheckpoint('Saved by hand');
    t.phoneCaughtUp();

    expect(await t.sync.saveCheckpoint('Saved by hand')).toEqual({ synced: true, allInSync: true, shared: true });
    expect(t.sync.useSyncStatus.getState().peers[0].inSync).toBe(true);
    expect(t.writeBackup).toHaveBeenCalledTimes(1);
  });

  it('can be recovered from on any device that reaches the same route', async () => {
    const t = await setup();
    t.store.setState({ questlines: [...t.store.getState().questlines, ql('l', 'Made on the laptop')] });
    await t.sync.saveCheckpoint('Before updating from v3.6.0 to v3.6.1');
    t.store.setState({ questlines: [ql('a', 'Shared')] });

    const [entry] = await t.sync.checkpoints();
    const copy = await t.sync.checkpointCopy(entry.name);
    expect(copy).not.toBeNull();
    expect(t.sync.compareWith(copy!)).toEqual([expect.objectContaining({ slot: 'quest', change: 'missing', label: 'Made on the laptop' })]);
  });

  it('still keeps a copy on this device when nothing else can be reached', async () => {
    const t = await setup({ backupOk: false });
    const result = await t.sync.saveCheckpoint('Before updating from v3.6.0 to v3.6.1');
    expect(result.shared).toBe(false);
    expect((await t.safety.listSafetySnapshots()).map(s => s.reason)).toContain('Before updating from v3.6.0 to v3.6.1');
  });

  it('does not claim the devices agreed while sync is paused', async () => {
    const t = await setup();
    await t.sync.setSyncPaused(true);
    expect(await t.sync.saveCheckpoint('Saved by hand')).toMatchObject({ synced: false, allInSync: false });
  });
});

it('reads a checkpoint name back into device, version and reason', async () => {
  const { describeCheckpoint } = await import('./cloudSync');
  expect(describeCheckpoint('checkpoint-2026-11-28T15-04-05-123Z_v3.6.0_Henry-s-iPhone_Saved-by-hand.json'))
    .toEqual({ device: 'Henry s iPhone', version: '3.6.0', reason: 'Saved by hand' });
  expect(describeCheckpoint('Laptop-before-adopt-2026.json')).toBeNull();
});
