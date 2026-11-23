/**
 * Script-side access to the duration tokens in motion.css.
 *
 * Framer-driven motion can't take a CSS variable as a duration, so it reads the
 * token's resolved value here. Reduced motion zeroes the tokens in CSS, which
 * means a caller that goes through this never needs its own media query.
 */
export type MotionToken = 'fast' | 'expand' | 'base' | 'check' | 'settle' | 'day-closed';

const FALLBACK_MS: Record<MotionToken, number> = {
  fast: 120, expand: 140, base: 180, check: 180, settle: 220, 'day-closed': 420,
};

/** No media queries at all (a non-browser host) counts as reduced: nothing there
 *  can show a transition, so nothing should wait for one. */
export const prefersReducedMotion = (): boolean =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A motion token in milliseconds: 0 under reduced motion. */
export function motionMs(token: MotionToken): number {
  if (prefersReducedMotion()) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${token}`).trim();
  const value = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(value) ? value : FALLBACK_MS[token];
}

/** The same token in seconds, the unit framer-motion takes. */
export const motionSeconds = (token: MotionToken): number => motionMs(token) / 1000;
