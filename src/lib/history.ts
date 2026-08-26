/**
 * Ctrl+Z for the whole app.
 *
 * Not a list of undoable actions — that approach needs every action to carry a
 * hand-written inverse, and the ones nobody remembers to write are exactly the
 * ones you want back. This records the state itself: a snapshot of both stores
 * before each change, restored wholesale. Anything that can change the data is
 * therefore undoable by construction, including whatever gets added next.
 *
 * It is cheap because the stores update immutably. A snapshot copies only the
 * top-level keys; every array and object underneath is shared with the live
 * state, so sixty steps of history cost sixty small objects, not sixty copies of
 * your tasks.
 *
 * Two things are deliberately kept out of it:
 *   - Automatic work. The 5am rollover, the archive purge and an incoming cloud
 *     sync are not things you did, so Ctrl+Z must not step through them — and a
 *     rollover landing mid-session would otherwise bury your real steps.
 *   - Typing inside a field, where Ctrl+Z has to keep meaning "undo my typing".
 *
 * The delete toast in undo.ts stays as it was: it restores one deleted item
 * precisely, keeping anything you did in the seconds since, which is a different
 * and better answer for that case than stepping the whole app back in time.
 */
import { useQuestStore } from '../store';
import { useVynuesStore } from '../vynuesStore';
import { useUndoStore } from './undo';

export interface Snapshot {
  quest: Record<string, unknown>;
  vynues: Record<string, unknown>;
}

/** How far back Ctrl+Z goes. Past this, the oldest step falls off. */
export const MAX_STEPS = 60;

/** Writes closer together than this belong to one gesture — a drag that fires a
 *  reorder per frame, a burst of edits saved together — and fold into a single
 *  step. Without it a single drag would cost dozens of Ctrl+Zs. */
export const COALESCE_MS = 400;

let past: Snapshot[] = [];
let future: Snapshot[] = [];
/** >0 while restoring, or inside `withoutHistory`. Nothing is recorded then. */
let muted = 0;
let lastAt = 0;
let started = false;

/** The data half of a store: its actions are functions and never change. */
const data = (s: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== 'function'));

const snapshot = (): Snapshot => ({
  quest: data(useQuestStore.getState()),
  vynues: data(useVynuesStore.getState()),
});

function apply(s: Snapshot) {
  muted++;
  try {
    useQuestStore.setState(s.quest as never);
    useVynuesStore.setState(s.vynues as never);
  } finally {
    muted--;
  }
}

function record(prev: Snapshot) {
  if (muted > 0) return;
  const now = Date.now();
  if (past.length && now - lastAt < COALESCE_MS) {
    // Folded into the step already on the stack, which is the state before the
    // gesture began — the point you actually want to come back to.
    lastAt = now;
    return;
  }
  past.push(prev);
  if (past.length > MAX_STEPS) past.shift();
  // A new change is a new branch: whatever was undone can no longer be redone.
  future = [];
  lastAt = now;
}

/** Begin recording. Idempotent, so React's double-mount in development can't
 *  subscribe twice and record every change two steps deep. */
export function startHistory(): void {
  if (started) return;
  started = true;
  useQuestStore.subscribe((_now, prev) =>
    record({ quest: data(prev), vynues: data(useVynuesStore.getState()) }));
  useVynuesStore.subscribe((_now, prev) =>
    record({ quest: data(useQuestStore.getState()), vynues: data(prev) }));
}

/**
 * Run `fn` without recording what it changes.
 *
 * For work the app does on its own behalf — see the header. Nested calls are
 * counted, so one of these inside another still leaves recording off until the
 * outermost finishes.
 */
export function withoutHistory<T>(fn: () => T): T {
  muted++;
  try {
    return fn();
  } finally {
    muted--;
  }
}

export const canUndo = (): boolean => past.length > 0;
export const canRedo = (): boolean => future.length > 0;

/** Step back one change. False when there is nothing to step back to. */
export function undo(): boolean {
  const prev = past.pop();
  if (!prev) return false;
  future.push(snapshot());
  apply(prev);
  // The next real change starts its own step rather than folding into the one
  // that was just restored.
  lastAt = 0;
  return true;
}

export function redo(): boolean {
  const next = future.pop();
  if (!next) return false;
  past.push(snapshot());
  apply(next);
  lastAt = 0;
  return true;
}

export function clearHistory(): void {
  past = [];
  future = [];
  lastAt = 0;
}

/** True when the key event should be left alone for the browser to handle — the
 *  caret is in something you can type into, where Ctrl+Z means the text. */
const inAField = (target: EventTarget | null): boolean =>
  // `instanceof Element` rather than a cast: a key event can be dispatched at
  // `window`, which has no `closest`, and reaching for it there throws.
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]');

/**
 * Bind Ctrl/⌘-Z and its redo twins to the history. Returns the unbind.
 *
 * The only place these keys are handled: two listeners would both fire on one
 * press, undo and then redo it, and look like nothing happened.
 */
export function installUndoHotkeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
    const isUndo = key === 'z' && !e.shiftKey;
    if (!isUndo && !isRedo) return;
    if (inAField(e.target)) return;
    e.preventDefault();

    // Any pending delete offer is about a state we are now stepping away from;
    // leaving it up would offer to restore something that is already back.
    useUndoStore.getState().dismiss();

    if (isUndo ? undo() : redo()) {
      // Undo is invisible when what changed is off-screen — on another tab, or
      // below the fold. The toast is how you know it landed, and the way back.
      useUndoStore.getState().push(
        isUndo ? 'Undone' : 'Redone',
        () => { if (isUndo) redo(); else undo(); },
        isUndo ? 'Redo' : 'Undo',
      );
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
