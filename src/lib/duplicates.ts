/**
 * Finding the same habit entered twice.
 *
 * The app renders one row per task, so a habit that looks doubled on Today is
 * two records — usually because it got typed once as a plain task and again as
 * an action inside a system, months apart, with the wording drifting ("Read 30
 * mins" / "Read 30 Minutes"). Both then collect half a streak each and neither
 * is right.
 *
 * Kept pure and separate from the store so the matching rule can be tested
 * directly: it decides when two of your tasks are declared the same thing, and
 * that is not something to verify by squinting at a list.
 */
import type { Routine } from '../types';

/** Words that mean the same thing written short. Folded so a task entered twice
 *  in different moods still matches — this is where the near-misses live. */
const SYNONYMS: Record<string, string> = {
  min: 'minute', mins: 'minute', minutes: 'minute', minute: 'minute',
  hr: 'hour', hrs: 'hour', hours: 'hour', hour: 'hour',
  sec: 'second', secs: 'second', seconds: 'second', second: 'second',
  day: 'day', days: 'day',
  week: 'week', weeks: 'week', wk: 'week', wks: 'week',
  x: 'times', times: 'times', time: 'times',
  oz: 'ounce', ounces: 'ounce', ounce: 'ounce',
  '&': 'and',
};

/** Filler that carries no meaning in a task name, so its presence or absence
 *  shouldn't decide whether two names are the same. */
const FILLER = new Set(['a', 'an', 'the', 'each', 'every', 'per', 'of', 'to', 'for', 'my']);

/**
 * The comparable form of a title: lower case, punctuation dropped, filler
 * removed, abbreviations expanded, words sorted out of order-dependence.
 *
 * Sorting the words is what catches "Read 30 minutes each day" against "Daily
 * read 30 min" — the same instruction with the cadence moved. It also means two
 * genuinely different tasks made of the same words collide, which is why this
 * only ever *suggests* a merge and never performs one.
 */
export function canonical(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s]/gu, ' ')
    // "3x" and "64oz" are a count and a unit written closed up; split them so the
    // unit can be folded like any other word.
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => !FILLER.has(w))
    .sort()
    .join(' ');
}

/** Two titles that name the same thing, as far as this can tell. */
export const sameTitle = (a: string, b: string): boolean => {
  const ca = canonical(a);
  return ca.length > 0 && ca === canonical(b);
};

/** A set of tasks that look like one task entered several times, best-kept first. */
export interface DuplicateGroup {
  /** The one to keep: most history, then longest streak, then oldest. */
  keep: Routine;
  /** The others, to be folded into it. */
  drop: Routine[];
}

/** How much a routine would lose by being the one deleted. Days recorded outrank
 *  a streak: a streak can be typed back in, a month of history cannot. */
const weight = (r: Routine, history: Record<string, string[]> | undefined): number =>
  (history?.[r.id]?.length ?? 0) * 1000 + (r.streak ?? 0);

/**
 * Group the visible routines by canonical title, returning only the groups with
 * more than one member — i.e. the ones worth showing you.
 *
 * Archived and hidden tasks are left out: a finished one-off that shares a name
 * with a live habit is not a duplicate of it.
 */
export function duplicateGroups(
  routines: Routine[],
  history?: Record<string, string[]>,
): DuplicateGroup[] {
  const byTitle = new Map<string, Routine[]>();
  for (const r of routines) {
    if (r.hidden) continue;
    const key = canonical(r.title);
    if (!key) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), r]);
  }

  return [...byTitle.values()]
    .filter(group => group.length > 1)
    .map(group => {
      const ranked = [...group].sort((a, b) =>
        weight(b, history) - weight(a, history)
        || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      return { keep: ranked[0], drop: ranked.slice(1) };
    })
    .sort((a, b) => a.keep.title.localeCompare(b.keep.title));
}
