/**
 * Life Vitals as a synced slot.
 *
 * Life Vitals keeps its areas in its own localStorage key rather than in a
 * zustand store, which is why it never travelled: sync only carried the three
 * stores. This adapts that key to the shape the reconciler exchanges — a string
 * of `{ state, version }` — and tells each side when the other has changed it.
 *
 * An empty list reads as "nothing here" and is never published. A device that
 * has simply never used Life Vitals must not be able to out-vote, with nothing,
 * a device that holds real check-ins.
 */
import { loadStatusVitals, statusVitalsKey, validStatusVitals, type StatusVital } from './statusVitals';

const TESTING = import.meta.env.MODE === 'testing';
const KEY = statusVitalsKey(TESTING);
/** The page saved (this device edited). */
const CHANGED = 'milestone:vitals-changed';
/** Sync wrote another device's areas (the page should reload them). */
export const VITALS_SYNCED = 'milestone:vitals-synced';

/** Called by the Life Vitals page after every save. */
export const noteVitalsChanged = () => window.dispatchEvent(new Event(CHANGED));

/** This device's areas in sync shape, or undefined when there are none. */
export function readVitalsSlot(): string | undefined {
  try {
    // Through the page's own loader, so areas still in the previous format count.
    const areas = loadStatusVitals(localStorage, TESTING);
    if (areas.length === 0) return undefined;
    return JSON.stringify({ state: { areas }, version: 0 });
  } catch { return undefined; }
}

/** The areas inside a slot string, or null if it isn't a valid one. */
export function parseVitalsSlot(raw: string): StatusVital[] | null {
  try {
    const areas: unknown = JSON.parse(raw)?.state?.areas;
    return validStatusVitals(areas) ? areas : null;
  } catch { return null; }
}

/** Writes another device's areas here and tells an open page to show them. */
export function applyVitalsSlot(raw: string): boolean {
  const areas = parseVitalsSlot(raw);
  if (!areas) return false;
  localStorage.setItem(KEY, JSON.stringify(areas));
  window.dispatchEvent(new Event(VITALS_SYNCED));
  return true;
}

export function subscribeVitals(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
