/** Stable presentation-only grouping; never change the saved manual sequence. */
export function completionOrder<T>(items: readonly T[], enabled: boolean, complete: (item: T) => boolean): T[] {
  if (!enabled) return [...items];
  return [...items.filter(item => !complete(item)), ...items.filter(complete)];
}
