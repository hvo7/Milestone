/** Drag-to-reorder plumbing for the Today list. Extracted from the page so the
 *  page reads as "what goes in the list" rather than "how a drag scrolls". */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { PanInfo } from 'framer-motion';

/** Scrolls the window while a reorder-drag is active and the pointer sits near
 *  the top or bottom edge of the *viewport*, so a long list can be reordered
 *  without first scrolling by hand to make room for the drop target: hold the
 *  row against an edge and the page comes to you. Speed eases in quadratically
 *  across the band — a slow creep where the band starts, topping out only once
 *  the pointer is hard against (or past) the screen edge — and is expressed in
 *  px/second against the real frame delta, so it feels the same on a 60Hz and a
 *  144Hz display.
 *
 *  Fed by the pointer position `Reorder.Item`'s `onDrag` reports — there's no
 *  native drag event to listen for the way HTML5 DnD has one. That position is
 *  in *page* coordinates (framer reads `pageX`/`pageY`), so `report` takes the
 *  scroll offset back off before the loop compares it to the viewport edges.
 *  Skipping that conversion is what made this run away: once the page was
 *  scrolled at all, page-Y was past `innerHeight` almost everywhere, every
 *  position read as "below the bottom edge", and the un-clamped ramp beyond the
 *  band squared it into a jump straight to the end of the list. */
function useDragAutoScroll(active: boolean) {
  // null until this drag reports its first position — an unseeded 0 would read
  // as "pointer pinned to the top of the screen" and yank the page up on grab.
  const pointerYRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const MIN_SPEED = 90, MAX_SPEED = 1000; // px/s entering the band / at the edge
    let previous = performance.now();
    let carry = 0; // sub-pixel remainder — scrollBy can't move less than a pixel
    let raf = requestAnimationFrame(function tick(now) {
      raf = requestAnimationFrame(tick);
      // Clamp the delta so one stalled frame (GC pause, window restore) spends
      // its backlog at ~50ms of travel instead of teleporting the page.
      const dt = Math.min(now - previous, 50) / 1000;
      previous = now;
      const y = pointerYRef.current;
      if (y === null) return;
      // Band scales with the window, bounded so it stays easy to hit on a short
      // one without swallowing a third of a tall one.
      const vh = window.innerHeight;
      const edge = Math.min(180, Math.max(90, vh * 0.2));
      const past = y < edge ? edge - y : y > vh - edge ? y - (vh - edge) : 0;
      if (!past) { carry = 0; return; }
      // Dragging past the screen edge is just full speed, never more.
      const t = Math.min(1, past / edge);
      const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * t * t;
      const step = carry + (y < edge ? -speed : speed) * dt;
      const whole = Math.trunc(step);
      carry = step - whole;
      if (whole) window.scrollBy(0, whole);
    });
    return () => { cancelAnimationFrame(raf); pointerYRef.current = null; };
  }, [active]);
  /** Feed the loop the pointer's latest page Y. */
  return useCallback((pageY: number) => { pointerYRef.current = pageY - window.scrollY; }, []);
}

/** Drag-to-reorder state for the To-Do list, built on framer-motion's `Reorder`
 *  primitives: the dragged row follows the pointer directly and its neighbours
 *  slide out of the way immediately, rather than the row staying put next to a
 *  separate gap marker. The live order lives in local state while dragging and
 *  is only written to the store once, on release — so a mid-drag reflow (a
 *  recurring task resetting, say) can't yank the list out from under a finger. */
export function useReorder(reorder: (ids: string[]) => void) {
  const [dragging, setDragging] = useState(false);
  const [liveOrder, setLiveOrderState] = useState<string[] | null>(null);
  const liveOrderRef = useRef<string[] | null>(null);
  const reportPointerY = useDragAutoScroll(dragging);

  // Dragging across text otherwise leaves a trail of blue selection highlight
  // over every row the cursor crosses, which reads as the UI glitching.
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('reordering');
    return () => document.body.classList.remove('reordering');
  }, [dragging]);

  const setLiveOrder = (v: string[] | null) => { liveOrderRef.current = v; setLiveOrderState(v); };

  return {
    dragging,
    /** The order to render right now: the live in-progress order while dragging,
     *  else whatever the caller's own sort produces. */
    orderOf: (baseIds: string[]) => liveOrder ?? baseIds,
    onReorder: setLiveOrder,
    onDragStart: () => setDragging(true),
    onDrag: (_e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => reportPointerY(info.point.y),
    onDragEnd: () => {
      setDragging(false);
      if (liveOrderRef.current) reorder(liveOrderRef.current);
      setLiveOrder(null);
    },
  };
}
