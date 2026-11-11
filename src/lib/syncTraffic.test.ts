import { expect, it, vi } from 'vitest';

it('an offline peer and own-file notifications do not repeat unchanged uploads', async () => {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
  let notify = () => {};
  const peers: unknown[] = [];
  const writes: { stores: unknown; slotClocks: unknown }[] = [];
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'synthetic', deviceId: 'desktop', deviceName: 'Desktop' }),
    readPeers: async () => ({ ok: true, peers }),
    write: async (doc: { stores: unknown; slotClocks: unknown }) => {
      writes.push(structuredClone(doc));
      setTimeout(() => notify(), 600);
      return { ok: true };
    },
    writeBackup: async () => ({ ok: true }),
    onChanged: (fn: () => void) => { notify = fn; return () => { notify = () => {}; }; },
  } } });
  const sync = await import('./cloudSync');
  try {
    const { useQuestStore } = await import('../store');
    useQuestStore.setState({ routines: [], questlines: [] });
    await sync.startCloudSync();
    peers.push({ _milestoneSync: 1, deviceId: 'offline-peer', deviceName: 'Offline',
      updatedAt: '2026-09-05T00:00:00Z', clock: {}, stores: writes[0].stores });
    writes.length = 0;
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(writes).toHaveLength(0);
    useQuestStore.setState({ questlines: [{ id: 'new', title: 'New edit', description: '', icon: '', color: '#369', quests: [] }] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(1);
    peers.length = 0;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(writes).toHaveLength(1);
  } finally {
    await sync.stopCloudSync(); delete window.electronAPI;
    vi.clearAllTimers(); vi.useRealTimers();
  }
});
