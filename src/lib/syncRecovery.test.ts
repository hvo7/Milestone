/**
 * Sync 3.5, end to end through the reconciler: the reported data loss, the
 * issue list, and the emergency tools. The merge rules themselves are covered
 * in syncMerge.test.ts; these check that the app wires them up correctly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncDoc } from './cloudSync';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; delete window.electronAPI; vi.clearAllTimers(); vi.useRealTimers(); });

type Json = Record<string, unknown>;
const questSlot = (questlines: Json[], routines: Json[] = []) =>
  JSON.stringify({ state: { questlines, routines, systems: [], completionLog: {}, taskHistory: {}, todoOrder: {} }, version: 0 });
const ql = (id: string, title: string) => ({ id, title, description: '', icon: '', color: 'sapphire', quests: [] });
const habit = (id: string, extra: Json = {}) => ({ id, title: id, recurring: 'daily' as const, completed: false, trackedToday: true, lastResetAt: '2026-11-20T10:00:00.000Z', ...extra });
const META = 'milestone-sync-meta';

interface Options { me?: string; before?: () => void; peers?: unknown[] }

async function setup({ me = 'laptop', before, peers = [] }: Options = {}) {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
  before?.();
  const write = vi.fn<(doc: SyncDoc) => Promise<{ ok: boolean; error?: string }>>().mockResolvedValue({ ok: true });
  const readPeers = vi.fn(async () => ({ ok: true, peers }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { sync: {
    getConfig: async () => ({ enabled: true, folder: 'synthetic', deviceId: me, deviceName: me[0].toUpperCase() + me.slice(1) }),
    readPeers, write, writeBackup: vi.fn().mockResolvedValue({ ok: true }), onChanged: () => () => {},
  } } });
  const sync = await import('./cloudSync');
  stop = sync.stopCloudSync;
  const { useQuestStore: store } = await import('../store');
  const { automatic } = await import('./syncIntent');
  const { useSyncIssues } = await import('./syncIssues');
  const safety = await import('./syncSafety');
  safety.resetSafetyForTests();
  return { sync, store, automatic, useSyncIssues, safety, write, readPeers, peers, published: () => JSON.parse(write.mock.lastCall![0].stores.quest!).state };
}

/** A laptop last synced days ago, as 3.4.1 left its bookkeeping. */
const staleLaptop = () => {
  const baseline = questSlot([ql('a', 'Shared')], [habit('walk')]);
  localStorage.setItem(META, JSON.stringify({ slots: { quest: { laptop: 3, phone: 5 }, vynues: {}, ui: {}, vitals: {} },
    published: { quest: baseline }, versions: { quest: { at: '2026-11-20T10:00:00.000Z', deviceId: 'laptop' } } }));
  localStorage.setItem('milestone-v1', baseline);
};

const phoneDoc = (withItems: boolean): SyncDoc => {
  const at = Date.parse('2026-11-25T09:00:00.000Z');
  return {
    _milestoneSync: 1, deviceId: 'phone', deviceName: 'Phone', updatedAt: '2026-11-25T09:00:00.000Z', appVersion: withItems ? '3.5.0' : '3.4.1',
    clock: { laptop: 3, phone: 6 }, slotClocks: { quest: { laptop: 3, phone: 6 } }, slotVersions: { quest: { at: '2026-11-25T09:00:00.000Z', deviceId: 'phone' } },
    stores: { quest: questSlot([ql('a', 'Shared'), ql('p', 'Made on phone')], [habit('walk', { completed: true, completedAt: '2026-11-25T08:00:00.000Z' })]) },
    ...(withItems ? { syncProtocol: 2, items: { quest: { s: {
      '/questlines': ['phone', 6, at, 0], '/questlines/p': ['phone', 6, at, 0], '/routines/walk': ['phone', 6, at, 0],
    }, t: {} } } } : {}),
  } as SyncDoc;
};

describe('the reported bug: opening a stale laptop wiped the phone\'s changes', () => {
  it.each([['on the new build', true], ['still on 3.4.1', false]])('keeps the phone\'s work when the phone is %s', async (_label, withItems) => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(withItems)] });
    // The laptop opens: its daily reset runs before sync has even connected.
    t.automatic(() => t.store.setState({ routines: [habit('walk', { lastResetAt: '2026-11-26T10:00:00.000Z' })] }));
    await t.sync.startCloudSync();

    const local = t.store.getState();
    expect(local.questlines.map(q => q.title)).toEqual(['Shared', 'Made on phone']);
    // The check-off made on the phone beats the laptop's automatic reset.
    expect(local.routines[0].completed).toBe(true);
    // What the laptop publishes carries the phone's work, so nothing flows back over it.
    expect((t.published().questlines as Json[]).map(q => q.id)).toEqual(['a', 'p']);
    const sent = t.write.mock.lastCall![0];
    expect(sent.items?.quest).toBeDefined();
    expect(sent.slotClocks!.quest!.phone).toBe(6);
    expect(t.useSyncIssues.getState().issues).toEqual([]);
  });

  it('still keeps an edit you made on the laptop to a different item', async () => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(true)] });
    t.store.setState({ questlines: [ql('a', 'Renamed on laptop')] });
    await t.sync.startCloudSync();
    expect(t.store.getState().questlines.map(q => q.title)).toEqual(['Renamed on laptop', 'Made on phone']);
  });

  it('keeps a safety copy of the laptop\'s data from before it took the phone\'s changes', async () => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(true)] });
    await t.sync.startCloudSync();
    await vi.advanceTimersByTimeAsync(0);
    const list = await t.safety.listSafetySnapshots();
    expect(list.map(s => s.reason)).toContain('Before taking changes from Phone');
    const copy = await t.safety.loadSafetySnapshot(list.find(s => s.reason.startsWith('Before taking'))!.id);
    expect(JSON.parse(copy!.stores.quest!).state.questlines.map((q: Json) => q.id)).toEqual(['a']);
  });
});

describe('updating devices one at a time', () => {
  it('a phone updated first keeps its earlier work when a laptop still on 3.4.1 sends its stale copy', async () => {
    // The phone made these before it updated; 3.4.1 published them unstamped.
    const phoneData = questSlot([ql('a', 'Shared'), ql('p', 'Made on phone last week')], [habit('walk', { completed: true })]);
    const t = await setup({ me: 'phone', before: () => {
      localStorage.setItem(META, JSON.stringify({ slots: { quest: { laptop: 3, phone: 6 }, vynues: {}, ui: {}, vitals: {} }, published: { quest: phoneData } }));
      localStorage.setItem('milestone-v1', phoneData);
    }, peers: [{
      // The laptop, opened on the old build, kept its own stale copy and took the clock.
      _milestoneSync: 1, deviceId: 'laptop', deviceName: 'Laptop', updatedAt: '2026-11-26T10:00:00.000Z', appVersion: '3.4.1',
      clock: { laptop: 4, phone: 6 }, slotClocks: { quest: { laptop: 4, phone: 6 } }, slotVersions: { quest: { at: '2026-11-26T10:00:00.000Z', deviceId: 'laptop' } },
      stores: { quest: questSlot([ql('a', 'Shared'), ql('l', 'Laptop, today')], [habit('walk', { lastResetAt: '2026-11-26T10:00:00.000Z' })]) },
    }] });
    await t.sync.startCloudSync();
    const local = t.store.getState();
    expect(local.questlines.map(q => q.title)).toEqual(['Shared', 'Made on phone last week', 'Laptop, today']);
    expect(local.routines[0].completed).toBe(true);
    // Guards go out with the phone's copy, so other updated devices hold the line too.
    expect(t.write.mock.lastCall![0].items!.quest!.s['/questlines/p']).toEqual(['phone', 6, expect.any(Number), 0]);
  });
});

describe('both devices updated, one of them stale', () => {
  it('the laptop takes the phone\'s pre-update work instead of reverting it with its own old copy', async () => {
    // Both on the new build. The phone made these under 3.4.1, after the
    // laptop last synced; its upgrade guarded them at its last count (6).
    const at = Date.parse('2026-11-25T09:00:00.000Z');
    const phone: SyncDoc = { ...phoneDoc(false), syncProtocol: 2, items: { quest: { s: {
      '/questlines': ['phone', 6, at, 0], '/questlines/a': ['phone', 6, at, 0], '/questlines/p': ['phone', 6, at, 0], '/routines': ['phone', 6, at, 0], '/routines/walk': ['phone', 6, at, 0],
    }, t: {} } } };
    const t = await setup({ before: staleLaptop, peers: [phone] });
    t.automatic(() => t.store.setState({ routines: [habit('walk', { lastResetAt: '2026-11-26T10:00:00.000Z' })] }));
    await t.sync.startCloudSync();
    expect(t.store.getState().questlines.map(q => q.title)).toEqual(['Shared', 'Made on phone']);
    expect(t.store.getState().routines[0].completed).toBe(true);
    expect(t.useSyncIssues.getState().issues).toEqual([]);
  });
});

describe('a device that comes back on 3.4.1 after the others updated', () => {
  /** The desktop's bookkeeping after one 3.4.1 session: it took the phone's
   *  count (phone: 9) but kept its own stale copy and published that. */
  const staleDesktop = (stale: string) => () => {
    localStorage.setItem(META, JSON.stringify({ slots: { quest: { desktop: 8, phone: 9, laptop: 4 }, vynues: {}, ui: {}, vitals: {} },
      published: { quest: stale }, versions: { quest: { at: '2026-12-01T09:00:00.000Z', deviceId: 'desktop' } } }));
    localStorage.setItem('milestone-v1', stale);
  };
  const phoneNow = (): SyncDoc => {
    const at = Date.parse('2026-11-27T05:00:00.000Z');
    return { _milestoneSync: 1, deviceId: 'phone', deviceName: 'Phone', updatedAt: '2026-11-30T00:00:00.000Z', appVersion: '3.5.0', syncProtocol: 2,
      clock: { phone: 9, laptop: 4, desktop: 7 }, slotClocks: { quest: { phone: 9, laptop: 4, desktop: 7 } },
      stores: { quest: questSlot([ql('a', 'Renamed on phone'), ql('p', 'Made on phone')], [habit('walk', { completed: true })]) },
      items: { quest: { s: {
        '/questlines': ['phone', 9, at, 0], '/questlines/a': ['phone', 9, at, 0], '/questlines/p': ['phone', 9, at, 0],
        '/routines': ['phone', 5, 0, 0], '/routines/walk': ['phone', 8, at, 0],
      }, t: {} } } };
  };

  it('takes the laptop and phone\'s latest data once it updates, keeping only what it made itself', async () => {
    const stale = questSlot([ql('a', 'Shared'), ql('d', 'Only on desktop')], [habit('walk')]);
    const t = await setup({ me: 'desktop', before: staleDesktop(stale), peers: [phoneNow()] });
    t.automatic(() => t.store.setState({ routines: [habit('walk', { lastResetAt: '2026-12-01T10:00:00.000Z' })] }));
    await t.sync.startCloudSync();
    const local = t.store.getState();
    expect(local.questlines.map(q => q.title)).toEqual(['Renamed on phone', 'Made on phone', 'Only on desktop']);
    expect(local.routines[0].completed).toBe(true);
    expect(t.useSyncIssues.getState().issues).toEqual([]);
    expect(t.sync.useSyncStatus.getState().notice).toContain('latest data from Phone');
    const sent = t.write.mock.lastCall![0];
    expect(sent.items!.quest!.s['/questlines/d'][0]).toBe('desktop');
    expect(JSON.parse(sent.stores.quest!).state.questlines.map((q: Json) => q.title)).toEqual(['Renamed on phone', 'Made on phone', 'Only on desktop']);
    await vi.advanceTimersByTimeAsync(0);
    expect((await t.safety.listSafetySnapshots()).map(s => s.reason)).toContain('Before taking changes from Phone');
  });

  it('does not publish its stale copy if it cannot reach the others on first launch', async () => {
    const t = await setup({ me: 'desktop', before: staleDesktop(questSlot([ql('a', 'Shared')])) });
    t.readPeers.mockResolvedValue({ ok: false, error: 'Offline' } as never);
    await t.sync.startCloudSync();
    t.store.setState({ questlines: [ql('a', 'Shared'), ql('x', 'Offline edit')] });
    await vi.advanceTimersByTimeAsync(800);
    expect(t.write).not.toHaveBeenCalled();
    // Back online, it joins and the offline edit goes out with it.
    t.readPeers.mockResolvedValue({ ok: true, peers: [phoneNow()] });
    await t.sync.syncNow();
    expect(t.store.getState().questlines.map(q => q.title).sort()).toEqual(['Made on phone', 'Offline edit', 'Renamed on phone']);
  });
});

describe('the sync issue list', () => {
  const conflictPeer = (): SyncDoc => ({
    _milestoneSync: 1, deviceId: 'phone', deviceName: 'Phone', updatedAt: '2099-01-01T00:00:00.000Z', syncProtocol: 2,
    clock: { laptop: 3, phone: 6 }, slotClocks: { quest: { laptop: 3, phone: 6 } },
    stores: { quest: questSlot([ql('a', 'Phone title')], [habit('walk')]) },
    items: { quest: { s: { '/questlines/a': ['phone', 6, Date.parse('2099-01-01'), 0] }, t: {} } },
  });

  it('records an item edited on two devices with the version that gave way, and restores it', async () => {
    const t = await setup({ before: staleLaptop, peers: [conflictPeer()] });
    // Renamed on the laptop and never synced, while the phone renamed it too.
    t.store.setState({ questlines: [ql('a', 'Laptop title')] });
    await t.sync.startCloudSync();
    expect(t.store.getState().questlines[0].title).toBe('Laptop title');
    const [issue] = t.useSyncIssues.getState().issues;
    expect(issue).toMatchObject({ kind: 'edit', label: 'Laptop title', keptFrom: 'Laptop', lostFrom: 'Phone', status: 'open' });
    expect(t.sync.useSyncStatus.getState().notice).toContain('two devices');

    expect(await t.sync.restoreIssue(issue)).toBe(true);
    expect(t.store.getState().questlines[0].title).toBe('Phone title');
    expect(t.useSyncIssues.getState().issues[0].status).toBe('restored');
    // The restored version goes out as the newest change, so it wins everywhere.
    const sent = t.write.mock.lastCall![0];
    expect(JSON.parse(sent.stores.quest!).state.questlines[0].title).toBe('Phone title');
    expect(sent.items!.quest!.s['/questlines/a'][0]).toBe('laptop');
    expect(sent.items!.quest!.s['/questlines/a'][1]).toBeGreaterThan(sent.slotClocks!.quest!.laptop - 1);
  });

  it('syncs the list itself, so dismissing on one device dismisses everywhere', async () => {
    const t = await setup({ before: staleLaptop, peers: [conflictPeer()] });
    t.store.setState({ questlines: [ql('a', 'Laptop title')] });
    await t.sync.startCloudSync();
    t.sync.dismissIssue(t.useSyncIssues.getState().issues[0]);
    await vi.advanceTimersByTimeAsync(800);
    const sent = t.write.mock.lastCall![0];
    expect(JSON.parse(sent.stores.issues!).state.issues[0].status).toBe('dismissed');
  });

  it('does not report the daily reset losing to a real change', async () => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(true)] });
    t.automatic(() => t.store.setState({ routines: [habit('walk', { lastResetAt: 'later' })] }));
    await t.sync.startCloudSync();
    expect(t.useSyncIssues.getState().issues).toEqual([]);
  });
});

describe('emergency tools', () => {
  it('pauses without losing edits, and sends them on resume', async () => {
    const t = await setup({ before: staleLaptop });
    await t.sync.startCloudSync();
    await t.sync.setSyncPaused(true);
    t.write.mockClear(); t.readPeers.mockClear();
    t.store.setState({ questlines: [ql('a', 'Shared'), ql('offline', 'Made while paused')] });
    await vi.advanceTimersByTimeAsync(800);
    await t.sync.syncNow();
    expect(t.write).not.toHaveBeenCalled();
    expect(t.readPeers).not.toHaveBeenCalled();
    expect(t.sync.useSyncStatus.getState().paused).toBe(true);
    await t.sync.setSyncPaused(false);
    expect((t.published().questlines as Json[]).map(q => q.id)).toEqual(['a', 'offline']);
  });

  it('brings back items from a safety copy without touching anything else', async () => {
    const t = await setup({ before: staleLaptop });
    await t.sync.startCloudSync();
    const { saveSafetySnapshot, listSafetySnapshots, loadSafetySnapshot } = t.safety;
    await saveSafetySnapshot('Test copy', { quest: questSlot([ql('a', 'Shared'), ql('gone', 'Lost questline')], [habit('walk')]) });
    t.store.setState({ questlines: [ql('a', 'Edited since')] });
    const copy = await loadSafetySnapshot((await listSafetySnapshots()).find(s => s.reason === 'Test copy')!.id);
    const source = { id: 'snap', label: 'the test copy', at: copy!.at, stores: copy!.stores };
    const missing = t.sync.missingFrom(source);
    expect(missing).toEqual([{ slot: 'quest', path: '/questlines/gone', label: 'Lost questline', change: 'missing' }]);
    await t.sync.bringBack(source, missing);
    expect(t.store.getState().questlines.map(q => q.title)).toEqual(['Edited since', 'Lost questline']);
    const sent = t.write.mock.lastCall![0];
    expect(sent.items!.quest!.s['/questlines/gone'][0]).toBe('laptop');
  });

  it('offers a different version of an item and sets just that item back', async () => {
    const t = await setup({ before: staleLaptop });
    await t.sync.startCloudSync();
    t.store.setState({ questlines: [ql('a', 'Overwritten title')] });
    const source = { id: 'x', label: 'an older copy', at: '', stores: { quest: questSlot([ql('a', 'Shared')], [habit('walk')]) } };
    const found = t.sync.compareWith(source);
    expect(found).toEqual([{ slot: 'quest', path: '/questlines/a', label: 'Shared', change: 'different' }]);
    await t.sync.bringBack(source, found);
    expect(t.store.getState().questlines[0].title).toBe('Shared');
  });

  it('restores a whole copy, deletions included', async () => {
    const t = await setup({ before: staleLaptop });
    await t.sync.startCloudSync();
    t.store.setState({ questlines: [ql('a', 'Shared'), ql('new', 'Added later')] });
    await vi.advanceTimersByTimeAsync(800);
    expect(t.write.mock.lastCall![0].items!.quest!.s['/questlines/new']).toBeDefined();
    await t.sync.restoreCopy({ id: 'x', label: 'an older copy', at: '', stores: { quest: questSlot([ql('a', 'Shared')], [habit('walk')]) } });
    expect(t.store.getState().questlines.map(q => q.id)).toEqual(['a']);
    expect(t.write.mock.lastCall![0].items!.quest!.t['/questlines/new']).toBeDefined();
  });

  it('makes this device\'s data win on every device', async () => {
    const peer = phoneDoc(true);
    const t = await setup({ before: staleLaptop, peers: [peer] });
    await t.sync.startCloudSync();
    t.store.setState({ questlines: [ql('a', 'Only this')] });
    await vi.advanceTimersByTimeAsync(800);
    await t.sync.shareThisDeviceEverywhere();
    const sent = t.write.mock.lastCall![0];
    const counter = sent.slotClocks!.quest!.laptop;
    expect(Object.values(sent.items!.quest!.s).every(dot => dot[0] === 'laptop' && dot[1] === counter)).toBe(true);
    expect(sent.items!.quest!.t['/questlines/p']).toEqual(['laptop', counter, expect.any(Number), 0]);
    expect(sent.slotClocks!.quest!.phone).toBe(6);
  });

  it('exports every copy it can see in one file', async () => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(true)] });
    await t.sync.startCloudSync();
    const bundle = t.sync.emergencyBundle();
    expect(bundle.thisDevice._milestone).toBe(2);
    expect(bundle.otherDevices.map(d => d.deviceName)).toEqual(['Phone']);
  });

  it('flags a device still on an older build and counts what it has not received', async () => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(false)] });
    t.store.setState({ questlines: [ql('a', 'Shared'), ql('l', 'Laptop only')] });
    await t.sync.startCloudSync();
    const [phone] = t.sync.useSyncStatus.getState().peers;
    expect(phone).toMatchObject({ deviceName: 'Phone', legacy: true, appVersion: '3.4.1' });
    expect(phone.waiting).toBeGreaterThan(0);
  });
});

describe('forgetting a replaced device', () => {
  it('ignores its copy from then on, on every device', async () => {
    const t = await setup({ before: staleLaptop, peers: [phoneDoc(false)] });
    await t.sync.startCloudSync();
    expect(t.sync.useSyncStatus.getState().peers.map(p => p.deviceName)).toEqual(['Phone']);
    t.sync.forgetPeer('phone');
    expect(t.sync.useSyncStatus.getState().peers).toEqual([]);
    await vi.advanceTimersByTimeAsync(800);
    // The list travels with the issues, so the others stop syncing with it too.
    expect(JSON.parse(t.write.mock.lastCall![0].stores.issues!).state.forgotten).toEqual(['phone']);
    // Its later writes are not merged.
    t.peers.splice(0, 1, { ...phoneDoc(false), clock: { phone: 50 }, slotClocks: { quest: { phone: 50 } },
      stores: { quest: questSlot([ql('zombie', 'From the old app')]) } });
    await t.sync.syncNow();
    expect(t.store.getState().questlines.map(q => q.id)).not.toContain('zombie');
  });
});

describe('joining', () => {
  it('a fresh phone takes the group\'s data and keeps what it made before pairing', async () => {
    const desktop: SyncDoc = { _milestoneSync: 1, deviceId: 'desktop', deviceName: 'Desktop', updatedAt: '2026-11-25T00:00:00.000Z', syncProtocol: 2,
      clock: { desktop: 4 }, slotClocks: { quest: { desktop: 4 } }, stores: { quest: questSlot([ql('d', 'From desktop')]) },
      items: { quest: { s: { '/questlines/d': ['desktop', 4, 1, 0] }, t: {} } } };
    const t = await setup({ me: 'phone', peers: [desktop], before: () => localStorage.setItem('milestone-v1', questSlot([ql('mine', 'Made before pairing')])) });
    await t.sync.startCloudSync();
    expect(t.store.getState().questlines.map(q => q.id)).toEqual(['d', 'mine']);
    const sent = t.write.mock.lastCall![0];
    expect(sent.items!.quest!.s['/questlines/mine'][0]).toBe('phone');
    expect(sent.slotClocks!.quest).toEqual({ desktop: 4, phone: 1 });
  });

  it('does not bring back an item the group deleted', async () => {
    const desktop: SyncDoc = { _milestoneSync: 1, deviceId: 'desktop', deviceName: 'Desktop', updatedAt: '2026-11-25T00:00:00.000Z', syncProtocol: 2,
      clock: { desktop: 4 }, slotClocks: { quest: { desktop: 4 } }, stores: { quest: questSlot([ql('d', 'From desktop')]) },
      items: { quest: { s: {}, t: { '/questlines/old': ['desktop', 3, 1, 0] } } } };
    const t = await setup({ me: 'phone', peers: [desktop], before: () => localStorage.setItem('milestone-v1', questSlot([ql('old', 'Deleted elsewhere')])) });
    await t.sync.startCloudSync();
    expect(t.store.getState().questlines.map(q => q.id)).toEqual(['d']);
  });
});
