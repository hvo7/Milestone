import { useCallback, useEffect, useRef, useState } from 'react';

/** How long to hold before a row lifts. Long enough that a tap-to-expand or a
 *  flick-scroll never arms it by accident, short enough to feel deliberate. */
const HOLD_MS = 350;
/** Drifting further than this before the hold completes means the gesture was a
 *  scroll (touch) or a sloppy click (mouse) — stand down rather than pick up. */
const SLOP_PX = 8;
/** Controls own their gestures: a hold that starts on the checkbox, the pencil or
 *  the ✕ must stay a click on that control. */
const CONTROL_SELECTOR = 'input, button, a, textarea, select, [role="button"]';

/** Handlers for one reorderable row. Deliberately carries no ref — see `registerRow`. */
export interface RowHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
}

export interface HoldReorder {
  /** Id of the row currently lifted, or null. */
  dragId: string | null;
  /** How far the lifted row has travelled, for its transform. */
  offsetY: number;
  /** Insertion slot, indexed into the list *without* the dragged row. */
  slot: number | null;
  /**
   * Each row reports its element here from an effect, rather than the hook handing
   * back a `ref` to spread. Row geometry is only ever read while a gesture is in
   * flight, so post-mount registration is soon enough — and keeping the ref out of
   * the render path is what lets `react-hooks/refs` pass.
   */
  registerRow: (id: string, el: HTMLElement | null) => void;
  rowProps: (id: string, index: number) => RowHandlers;
}

/**
 * Hold a row — mouse or finger — then drag it up or down to reorder. Built on
 * pointer events so one code path covers both, rather than the HTML5 drag-and-drop
 * the edit-mode lists use: `dragstart` never fires from touch, so those lists are
 * mouse-only by construction.
 *
 * `commit` receives the reordered ids of exactly the rows this hook was given, so
 * a caller rendering a filtered view must map them back onto its full list.
 */
export function useHoldToReorder(ids: string[], commit: (next: string[]) => void): HoldReorder {
  const [dragId, setDragId]   = useState<string | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const [slot, setSlot]       = useState<number | null>(null);

  const els     = useRef(new Map<string, HTMLElement>());
  const slotRef = useRef<number | null>(null);
  /** Set the moment a row lifts, so the click that ends the gesture doesn't also
   *  expand the row. Cleared on the next pointerdown. */
  const swallowClick = useRef(false);
  /** Undo whatever the active gesture changed — always safe to call twice. */
  const release = useRef<() => void>(() => {});
  const idsRef    = useRef(ids);
  const commitRef = useRef(commit);

  // Latest values for the pointer handlers, which read them long after render.
  useEffect(() => { idsRef.current = ids; }, [ids]);
  useEffect(() => { commitRef.current = commit; }, [commit]);

  // A gesture in flight owns global listeners and body styles; unmounting mid-drag
  // (route change, questline collapse) must not leave either behind.
  useEffect(() => () => release.current(), []);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent, id: string, index: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(CONTROL_SELECTOR)) return;

    swallowClick.current = false;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const node = e.currentTarget as HTMLElement;
    let armed = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (armed) {
        document.body.classList.remove('reordering');
        node.style.touchAction = '';
        try { node.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      release.current = () => {};
      setDragId(null);
      setOffsetY(0);
      setSlot(null);
      slotRef.current = null;
    };
    release.current = cleanup;

    /** Midpoints of every row *except* the dragged one, snapshotted at lift-off.
     *  Rows expand to show their tasks, so heights vary — assuming a uniform row
     *  height would drop the row into the wrong slot in any expanded list. */
    let mids: number[] = [];

    const lift = () => {
      armed = true;
      swallowClick.current = true;
      mids = idsRef.current
        .filter(rid => rid !== id)
        .map(rid => {
          const el = els.current.get(rid);
          if (!el) return Number.POSITIVE_INFINITY;
          const r = el.getBoundingClientRect();
          return r.top + r.height / 2;
        });
      // Only once the row is airborne: until then the list must still scroll
      // normally under a finger, and text must stay selectable under a mouse.
      // `body.reordering` is the same class Today's to-do drag uses — it kills the
      // selection highlight and pins the cursor to grabbing.
      document.body.classList.add('reordering');
      node.style.touchAction = 'none';
      try { node.setPointerCapture(pointerId); } catch { /* capture is best-effort */ }
      slotRef.current = index;
      setDragId(id);
      setSlot(index);
      setOffsetY(0);
    };

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!armed) {
        if (Math.abs(dy) > SLOP_PX) cleanup();
        return;
      }
      if (ev.cancelable) ev.preventDefault();
      setOffsetY(dy);
      // Insertion index into the list minus the dragged row — what splice wants.
      const next = mids.filter(m => m < ev.clientY).length;
      if (next !== slotRef.current) {
        slotRef.current = next;
        setSlot(next);
      }
    };

    const onUp = () => {
      const target = slotRef.current;
      if (armed && target !== null && target !== index) {
        const next = idsRef.current.filter(rid => rid !== id);
        next.splice(target, 0, id);
        commitRef.current(next);
      }
      cleanup();
    };

    const timer = window.setTimeout(lift, HOLD_MS);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const rowProps = useCallback((id: string, index: number): RowHandlers => ({
    onPointerDown: (e: React.PointerEvent) => onPointerDown(e, id, index),
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  }), [onPointerDown]);

  return { dragId, offsetY, slot, registerRow, rowProps };
}
