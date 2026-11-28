/**
 * Every update starts from a checkpoint: the desktop's "Restart now", an
 * install on quit, and the phone's reload all wait for one (within limits),
 * and the same target version is not checkpointed twice for nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckpointResult } from './cloudSync';

const done: CheckpointResult = { synced: true, allInSync: true, shared: true };

afterEach(() => {
  vi.doUnmock('./cloudSync'); vi.doUnmock('./appUpdate');
  delete window.electronAPI;
  vi.useRealTimers();
});

type Save = (reason: string) => Promise<CheckpointResult>;

async function load({ save = vi.fn<Save>(async () => done) } = {}) {
  vi.resetModules();
  vi.doMock('./cloudSync', () => ({ saveCheckpoint: save }));
  const hooks: { before?: ((target: string | null) => Promise<unknown>) | null } = {};
  vi.doMock('./appUpdate', () => ({ setBeforeUpdate: (fn: typeof hooks.before) => { hooks.before = fn; } }));
  const mod = await import('./updateCheckpoint');
  return { ...mod, save, hooks };
}

function desktop(initial: Partial<DesktopUpdateStatus>) {
  let listener: (status: DesktopUpdateStatus) => void = () => {};
  const apply = vi.fn(async () => ({ ok: true }));
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { update: {
    status: async () => initial as DesktopUpdateStatus,
    check: async () => initial as DesktopUpdateStatus,
    apply,
    onStatus: (fn: typeof listener) => { listener = fn; return () => {}; },
  } } });
  return { apply, emit: (status: Partial<DesktopUpdateStatus>) => listener(status as DesktopUpdateStatus) };
}

describe('taking the checkpoint', () => {
  it('names the versions involved and takes one per target version', async () => {
    const t = await load();
    await t.checkpointBeforeUpdate('3.6.1');
    await t.checkpointBeforeUpdate('3.6.1');
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.save.mock.calls[0][0]).toMatch(/^Before updating from v.+ to v3\.6\.1$/);
    await t.checkpointBeforeUpdate('3.6.1', { fresh: true });
    expect(t.save).toHaveBeenCalledTimes(2);
  });

  it('never fails an update over a checkpoint that could not be saved', async () => {
    const t = await load({ save: vi.fn<Save>(async () => { throw new Error('disk full'); }) });
    await expect(t.checkpointBeforeUpdate('3.6.1')).resolves.toEqual({ synced: false, allInSync: false, shared: false });
  });
});

describe('the desktop and laptop', () => {
  it('checkpoint as soon as an update is downloaded, since it may install on quit', async () => {
    const t = await load();
    const device = desktop({ phase: 'idle' } as Partial<DesktopUpdateStatus>);
    t.startUpdateCheckpoints();
    await vi.waitFor(() => expect(typeof t.hooks.before).toBe('function'));
    device.emit({ phase: 'staged', stagedVersion: '3.6.1' } as Partial<DesktopUpdateStatus>);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.save.mock.calls[0][0]).toContain('to v3.6.1');
  });

  it('"Restart now" saves a fresh checkpoint before swapping in the new build', async () => {
    const order: string[] = [];
    const t = await load({ save: vi.fn<Save>(async () => { order.push('checkpoint'); return done; }) });
    const device = desktop({ phase: 'staged', stagedVersion: '3.6.1' } as Partial<DesktopUpdateStatus>);
    device.apply.mockImplementation(async () => { order.push('restart'); return { ok: true }; });
    await t.restartOntoUpdate('3.6.1');
    expect(order).toEqual(['checkpoint', 'restart']);
  });

  it('restarts anyway if the checkpoint hangs, after a bounded wait', async () => {
    vi.useFakeTimers();
    const t = await load({ save: vi.fn<Save>(() => new Promise<CheckpointResult>(() => {})) });
    const device = desktop({ phase: 'staged', stagedVersion: '3.6.1' } as Partial<DesktopUpdateStatus>);
    const restarting = t.restartOntoUpdate('3.6.1');
    await vi.advanceTimersByTimeAsync(t.RESTART_WAIT_MS - 1);
    expect(device.apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await restarting;
    expect(device.apply).toHaveBeenCalledTimes(1);
  });
});

describe('the phone', () => {
  it('registers the checkpoint as the step before every reload onto a new build', async () => {
    const t = await load();
    t.startUpdateCheckpoints();
    await t.hooks.before!('3.6.1');
    expect(t.save).toHaveBeenCalledWith(expect.stringContaining('to v3.6.1'));
  });
});

describe('the reload onto a new build (appUpdate)', () => {
  async function loadUpdate() {
    vi.resetModules();
    const mod = await import('./appUpdate');
    const reload = vi.fn();
    mod.page.reload = reload;
    return { ...mod, reload };
  }

  it('waits for the checkpoint, showing that it is saving', async () => {
    const u = await loadUpdate();
    let finish!: () => void;
    u.setBeforeUpdate(() => new Promise<void>(resolve => { finish = resolve; }));
    const applying = u.applyUpdate();
    await Promise.resolve();
    expect(u.useAppUpdate.getState().saving).toBe(true);
    expect(u.reload).not.toHaveBeenCalled();
    finish();
    await applying;
    expect(u.reload).toHaveBeenCalledTimes(1);
    expect(u.useAppUpdate.getState().saving).toBe(false);
  });

  it('is never held back by a checkpoint that cannot finish', async () => {
    vi.useFakeTimers();
    const u = await loadUpdate();
    u.setBeforeUpdate(() => new Promise(() => {}));
    const applying = u.applyUpdate();
    await vi.advanceTimersByTimeAsync(u.PREPARE_MS);
    await applying;
    expect(u.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads straight away when nothing is registered', async () => {
    const u = await loadUpdate();
    await u.applyUpdate();
    expect(u.reload).toHaveBeenCalledTimes(1);
  });
});
