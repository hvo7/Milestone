/**
 * Renderer half of the automatic backups (the disk half is electron/backups.cjs).
 *
 * The stores live in localStorage, which the main process can't read, so the
 * snapshot has to originate here. Two triggers, for two different failure modes:
 *
 *   on launch  — catches "the profile was fine yesterday and is empty today",
 *                which is the case that actually bit us. Runs *before* anything
 *                can overwrite the loaded state.
 *   after edits — a day's work shouldn't be lost because the app never restarted.
 *                 Debounced hard: this is a backup, not a journal.
 *
 * Where they go depends on the build: the desktop app writes files beside its
 * profile (electron/backups.cjs); a browser tab writes to IndexedDB
 * (lib/webBackup.ts). Same format, same window, same restore UI — the web copies
 * are simply weaker, since clearing site data takes them along with the stores.
 */
import { QUEST_STORE_KEY, useQuestStore } from '../store';
import { VYNUES_STORE_KEY, useVynuesStore } from '../vynuesStore';
import { APP_VERSION } from '../buildInfo';
import * as webBackup from './webBackup';

/** Long enough that a session of editing produces one snapshot rather than
 *  dozens; short enough that closing the laptop an hour in is still covered. */
const SETTLE_MS = 5 * 60_000;

/** Where snapshots are kept, and how durable that is. The card in the Data panel
 *  words itself from this rather than re-deriving which build it is running in. */
export type BackupStore = 'disk' | 'browser' | 'none';

export function backupStore(): BackupStore {
  if (window.electronAPI?.backup) return 'disk';
  return webBackup.webBackupAvailable() ? 'browser' : 'none';
}

/** The save/list/read trio for whichever store this build has. */
const bridge = () => window.electronAPI?.backup ?? (webBackup.webBackupAvailable() ? webBackup : null);

/** The same shape DataModal exports and the sync layer parks rescue copies in,
 *  so every restore path reads one format. */
export function currentBundle(): MilestoneBundle {
  return {
    _milestone: 2,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    quest: localStorage.getItem(QUEST_STORE_KEY) ?? undefined,
    vynues: localStorage.getItem(VYNUES_STORE_KEY) ?? undefined,
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleSnapshot() {
  if (!bridge()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void snapshotNow(); }, SETTLE_MS);
}

/** Take a snapshot immediately. The disk side no-ops when nothing has changed,
 *  so calling this more often than necessary is cheap. */
export async function snapshotNow(): Promise<void> {
  const api = bridge();
  if (!api) return;
  try {
    await api.save(currentBundle());
  } catch {
    // Backups are insurance; a failure here must never surface as a broken app.
  }
}

/** Called once at startup, alongside the first render. */
export function startAutoBackup(): void {
  if (!bridge()) return;

  // Before anything else touches the stores — including a sync adoption, which
  // can legitimately replace everything on this machine.
  void snapshotNow();

  useQuestStore.subscribe(scheduleSnapshot);
  useVynuesStore.subscribe(scheduleSnapshot);

  // Closing the window is the last chance to capture the session's work, and the
  // debounce may still be pending. Best-effort: the IPC may not complete, but the
  // launch snapshot means at worst we lose one session rather than everything.
  window.addEventListener('beforeunload', () => { if (timer) void snapshotNow(); });
}

/** Newest-first list for the restore picker. */
export async function listBackups(): Promise<AutoBackup[]> {
  const api = bridge();
  if (!api) return [];
  try { return await api.list(); } catch { return []; }
}

/**
 * Restores a snapshot into localStorage. Deliberately does *not* reload — the
 * caller does that, after telling the user what is about to happen.
 *
 * Takes its own snapshot of the current state first: restoring is itself a way
 * to lose data if you pick the wrong file, and the thing you replaced should
 * still be on disk afterwards.
 */
export async function restoreBackup(name: string): Promise<{ ok: boolean; error?: string }> {
  const api = bridge();
  if (!api) return { ok: false, error: 'This build has nowhere to keep automatic backups.' };
  try {
    await api.save(currentBundle());

    const res = await api.read(name);
    if (!res.ok || !res.bundle) return { ok: false, error: res.error ?? 'Could not read that backup.' };

    const { quest, vynues } = res.bundle;
    if (typeof quest !== 'string' && typeof vynues !== 'string') {
      return { ok: false, error: 'That backup is empty.' };
    }
    if (typeof quest === 'string')  localStorage.setItem(QUEST_STORE_KEY, quest);
    if (typeof vynues === 'string') localStorage.setItem(VYNUES_STORE_KEY, vynues);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
