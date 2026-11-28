/**
 * Every update starts from a checkpoint.
 *
 * Before any copy of Milestone moves to a new version — the desktop or laptop
 * swapping in a downloaded build, the phone reloading onto a new deploy — it
 * exchanges with the other devices one last time and saves the result: on the
 * device, on the relay and in the cloud folder (`saveCheckpoint` in cloudSync).
 * Whatever the new version then does on its first run, the state every device
 * last shared is one step back, under Sync health › Recover items.
 *
 * The desktop takes its checkpoint as soon as an update is downloaded, because
 * it may install on quit with no chance to do anything first; "Restart now"
 * refreshes it if anything changed since. The phone takes it as soon as it
 * learns of a new build, while it is still in front and online, and the reload
 * waits for it (never longer than PREPARE_MS).
 */
import { APP_VERSION } from '../buildInfo';
import { saveCheckpoint, type CheckpointResult } from './cloudSync';
import { setBeforeUpdate } from './appUpdate';

const failed: CheckpointResult = { synced: false, allInSync: false, shared: false };
const taken = new Map<string, Promise<CheckpointResult>>();

const reasonFor = (target: string | null) => `Before updating from v${APP_VERSION}${target ? ` to v${target}` : ''}`;

/** One checkpoint per target version; `fresh` takes another if the data moved since. */
export function checkpointBeforeUpdate(target: string | null, { fresh = false } = {}): Promise<CheckpointResult> {
  const key = target ?? 'next';
  const previous = taken.get(key);
  if (previous && !fresh) return previous;
  const next = saveCheckpoint(reasonFor(target)).catch(() => failed);
  taken.set(key, next);
  return next;
}

/** Resolves with the work's result, or null if it takes longer than `ms`. */
export function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
}

export const RESTART_WAIT_MS = 20_000;

/** "Restart now" on the desktop: a current checkpoint, then the new build. */
export async function restartOntoUpdate(target: string | null): Promise<void> {
  await within(checkpointBeforeUpdate(target, { fresh: true }), RESTART_WAIT_MS);
  await window.electronAPI?.update?.apply();
}

export function startUpdateCheckpoints(): () => void {
  setBeforeUpdate(target => checkpointBeforeUpdate(target));
  const api = window.electronAPI?.update;
  if (!api) return () => setBeforeUpdate(null);
  const onStatus = (status: DesktopUpdateStatus) => {
    if (status.phase === 'staged' && status.stagedVersion) void checkpointBeforeUpdate(status.stagedVersion);
  };
  void api.status().then(onStatus).catch(() => {});
  const off = api.onStatus(onStatus);
  return () => { off(); setBeforeUpdate(null); };
}

/** For tests. */
export const resetCheckpointsForTests = () => taken.clear();
