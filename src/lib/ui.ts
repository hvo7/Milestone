import type { Subtask } from '../types';
import type { VynuesSubtask } from '../vynuesStore';
import type { SubNode } from '../components/SubtaskTree';

/**
 * Pure mappings shared across pages and drawers. Each of these existed as three
 * or four near-identical copies; this is the single definition.
 * (The shared <Field> component lives in components/Field.tsx — keeping JSX out
 * of this file is what lets fast refresh work on both.)
 */

/**
 * Display name for the anchor-habit group — the highlighted standalone habits
 * that reset and build a streak each period (`routine.anchor`).
 *
 * Purely cosmetic, and deliberately in one place: the stored identity is the
 * `anchor` flag on the routine itself, so this can be re-worded freely without
 * touching a single saved task. (It was briefly neutralised to "Anchor Habits"
 * when the repo went public; the habits themselves never moved.)
 */
export const ANCHOR_LABEL = 'Fixing my Chud life';
export const ANCHOR_TAG   = 'Chud life';
export const ANCHOR_ICON  = '🛠️';

/** Sentinel category key for the anchor-habit group in the create/edit drawers.
 *  Lives here rather than in a drawer so pages can reference it without pulling
 *  a lazily-loaded drawer into the entry chunk. */
export const ANCHOR_CATEGORY = '__anchor__';

/** Questline/project accent hexes — the fixed palette, mirrored from index.css
 *  `--color-*` for the places that need a raw value rather than a CSS var. */
export const CATEGORY_HEX: Record<string, string> = {
  crimson: '#fb7185', sapphire: '#38bdf8',
  emerald: '#34d399', amber: '#fbbf24', violet: '#a78bfa',
};

/** Accent hex for a questline/project color — a legacy preset name, a raw hex
 *  string from the color picker, or nothing, falling back to the app accent. */
export const categoryColor = (c?: string): string => {
  if (!c) return 'var(--accent)';
  if (CATEGORY_HEX[c]) return CATEGORY_HEX[c];
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
  return 'var(--accent)';
};

/**
 * Is a counter worth drawing as a tappable ladder under its row?
 *
 * Two segments is a toggle and thirteen is a progress bar, which is what the
 * counter already is. In between — "64 oz in steps of 16" — it's four rungs you
 * can hit directly instead of nudging ＋ four times.
 *
 * Lives here rather than beside the component so both the row and the page can
 * ask without either importing the other's module.
 */
export const CHECKPOINT_MAX_SEGMENTS = 12;

export const hasCheckpoints = (target: number, step: number): boolean => {
  const segments = Math.ceil(target / Math.max(1, step));
  return segments >= 2 && segments <= CHECKPOINT_MAX_SEGMENTS;
};

/** Strip the leading roman numeral from a quest title ("III — Ship it" → "Ship it"). */
export const cleanQuest = (title: string): string =>
  title.replace(/^[IVXLCDM]+\s*[—-]+\s*/u, '').trim();

// ── Subtask → SubtaskTree node mapping ───────────────────────────────────────
// SubtaskTree renders a store-agnostic {id,title,done,children} node, so each
// store's tree is mapped into that shape here rather than in every caller.
// `forceOpen` renders the tree unchecked without touching stored data — the
// Today tab's tomorrow preview uses it to show a cycle that will have reset.

/** Map a routine's subtask tree into SubtaskTree nodes. */
export function routineSubNodes(list: Subtask[] | undefined, forceOpen = false): SubNode[] {
  return (list ?? []).map(st => ({
    id: st.id,
    title: st.title,
    done: forceOpen ? false : st.completed,
    children: routineSubNodes(st.children, forceOpen),
  }));
}

/** Map a Vynues task's subtask tree into SubtaskTree nodes. */
export function vynuesSubNodes(list: VynuesSubtask[] | undefined, forceOpen = false): SubNode[] {
  return (list ?? []).map(st => ({
    id: st.id,
    title: st.title,
    done: forceOpen ? false : st.done,
    children: vynuesSubNodes(st.children, forceOpen),
  }));
}

/** Done/total across a SubtaskTree node list (counts every nested level). */
export function countSubNodes(list: SubNode[]): { done: number; total: number } {
  return list.reduce((acc, n) => {
    const kids = countSubNodes(n.children ?? []);
    return { done: acc.done + (n.done ? 1 : 0) + kids.done, total: acc.total + 1 + kids.total };
  }, { done: 0, total: 0 });
}
