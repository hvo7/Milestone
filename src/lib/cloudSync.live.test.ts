import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
  const { startCloudSync, syncNow } = await import('./cloudSync');
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
