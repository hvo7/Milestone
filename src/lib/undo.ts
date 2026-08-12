/**
 * One-level undo for destructive actions.
 *
 * Deleting a questline used to be a single unconfirmed ✕ that also took every
 * quest, action and linked task with it — months of streak history gone with no
 * way back. The rolling snapshots don't cover that: they're for "the profile is
 * empty this morning", and restoring one rolls back *everything else too*.
 *
 * A confirm dialog is the usual answer and it's the wrong one — it's friction on
 * every deliberate delete, and it trains you to click through, so by the time it
 * matters it isn't read. An undo costs nothing when you meant it and is a real
 * remedy when you didn't.
 *
 * Deliberately single-slot. An undo stack invites "undo something from five
 * minutes ago", by which point the state it was captured against has moved on and
 * putting the item back is a guess. One entry, one clear meaning: put back the
 * thing that just vanished.
 *
 * This store is *not* persisted — an undo closure captures a store snapshot in
 * memory, which cannot survive a reload and must not look as though it could.
 */
import { create } from 'zustand';

export interface UndoEntry {
  /** Identity for the toast's animation, so a new entry re-plays rather than
   *  silently swapping its text. */
  id: string;
  /** What was undone, e.g. `Deleted "Health & Fitness" · 4 quests, 3 tasks`. */
  label: string;
  /** Epoch ms; the toast uses it to expire itself. */
  at: number;
  undo: () => void;
}

/** How long the offer stays up. Long enough to notice a mis-click and react,
 *  short enough that the toast isn't furniture. */
export const UNDO_WINDOW_MS = 12_000;

interface UndoState {
  entry: UndoEntry | null;
  /** Register an undoable action, replacing any pending one. */
  push: (label: string, undo: () => void) => void;
  /** Run the pending undo (no-op when there isn't one). */
  run: () => void;
  dismiss: () => void;
}

let seq = 0;

export const useUndoStore = create<UndoState>()((set, get) => ({
  entry: null,

  push: (label, undo) => set({ entry: { id: `u${++seq}`, label, at: Date.now(), undo } }),

  run: () => {
    const entry = get().entry;
    if (!entry) return;
    // Cleared *before* the closure runs: an undo that throws must not stay on
    // offer, and clearing first makes a double-click a no-op rather than a second
    // restore (which the restorers also guard against by id).
    set({ entry: null });
    entry.undo();
  },

  dismiss: () => set({ entry: null }),
}));

/** Register an undoable action. The module-level entry point, so stores can call
 *  it without importing React or a hook. */
export const pushUndo = (label: string, undo: () => void): void =>
  useUndoStore.getState().push(label, undo);

// ── Restoring items to where they were ───────────────────────────────────────
// Undo re-inserts at the original index rather than appending: a task that comes
// back at the bottom of a list it was in the middle of is only half restored.

/** Insert `item` at `index`, clamped to the list's current length. */
export function insertAt<T>(list: T[], index: number, item: T): T[] {
  const out = [...list];
  out.splice(Math.max(0, Math.min(index, out.length)), 0, item);
  return out;
}

/** An item plucked out of a list, with the position it came from. */
export interface Removed<T> { index: number; item: T; }

/** Capture every element matching `pred`, with its index, before a filter drops them. */
export const captureRemoved = <T>(list: T[], pred: (item: T) => boolean): Removed<T>[] =>
  list.reduce<Removed<T>[]>((acc, item, index) => (pred(item) ? [...acc, { index, item }] : acc), []);

/**
 * Put captured items back at their original indices.
 *
 * Ascending, so each splice sees the earlier restores already in place, and
 * skipping any id that is somehow present again — a restore must never be able to
 * duplicate a live item, whatever ran in between.
 */
export function reinsert<T extends { id: string }>(list: T[], removed: Removed<T>[]): T[] {
  const live = new Set(list.map(x => x.id));
  return [...removed]
    .sort((a, b) => a.index - b.index)
    .reduce((acc, { index, item }) => (live.has(item.id) ? acc : insertAt(acc, index, item)), list);
}

/** Plural-aware count fragment for an undo label ("3 tasks", "1 task"). */
export const countLabel = (n: number, one: string, many?: string): string =>
  `${n} ${n === 1 ? one : (many ?? `${one}s`)}`;

/** One clause of a delete label's cascade: how many, the singular noun, and an
 *  irregular plural where "+s" won't do. */
export type Cascade = [count: number, noun: string, plural?: string];

/** Assemble a delete label, appending the cascade only when there is one — a
 *  questline that took four quests and three tasks with it should say so, and a
 *  bare one shouldn't pad the toast with "0 quests, 0 tasks". */
export function deleteLabel(what: string, cascade: Cascade[] = []): string {
  const parts = cascade.filter(([n]) => n > 0).map(([n, noun, plural]) => countLabel(n, noun, plural));
  return `Deleted “${what}”${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}
