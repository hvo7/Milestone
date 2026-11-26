/**
 * Tells sync which changes the app made on its own.
 *
 * The daily reset unchecks habits and restarts cycles on every device that
 * opens after the boundary. That is bookkeeping, not news: if the phone checked
 * a habit off this morning, a laptop opened tonight must not override the
 * check-off with its own reset of the same habit. So whatever runs inside
 * `automatic()` is remembered by value; when sync stamps it, it is stamped as
 * automatic, and any change you make to that item afterwards makes it yours.
 *
 * It reads the persisted strings before and after, so it sees exactly what was
 * saved — zustand writes localStorage synchronously inside `set`.
 */
import { QUEST_STORE_KEY, UI_STORE_KEY } from '../uiStore';
import { VYNUES_STORE_KEY } from '../vynuesStore';
import { explode } from './syncMerge';

type AutoSlot = 'quest' | 'vynues' | 'ui';
const KEYS: Record<AutoSlot, string> = { quest: QUEST_STORE_KEY, vynues: VYNUES_STORE_KEY, ui: UI_STORE_KEY };

/** slot → path → the value the app produced (null when it removed the item). */
const marks = new Map<string, Map<string, string | null>>();

const read = () => Object.fromEntries((Object.keys(KEYS) as AutoSlot[]).map(slot => [slot, localStorage.getItem(KEYS[slot])])) as Record<AutoSlot, string | null>;

export function automatic<T>(fn: () => T): T {
  const before = read();
  try {
    return fn();
  } finally {
    const after = read();
    for (const slot of Object.keys(KEYS) as AutoSlot[]) {
      if (before[slot] === after[slot] || after[slot] === null) continue;
      const old = explode(before[slot]);
      const now = explode(after[slot]);
      if (!now) continue;
      const slotMarks = marks.get(slot) ?? new Map<string, string | null>();
      for (const [path, entity] of now) if (old?.get(path)?.value !== entity.value) slotMarks.set(path, entity.value);
      for (const path of old?.keys() ?? []) if (!now.has(path)) slotMarks.set(path, null);
      marks.set(slot, slotMarks);
    }
  }
}

/** What the app did on its own to this slot and has not yet been stamped. */
export const automaticMarks = (slot: string): Map<string, string | null> | undefined => marks.get(slot);

/** Called once those changes carry their stamps. */
export function clearAutomaticMarks(slot: string, paths: string[]): void {
  const slotMarks = marks.get(slot);
  if (!slotMarks) return;
  for (const path of paths) slotMarks.delete(path);
}
