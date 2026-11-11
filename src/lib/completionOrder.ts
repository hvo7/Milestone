/** Stable presentation-only grouping; never change the saved manual sequence. */
export function completionOrder<T>(items: readonly T[], enabled: boolean, complete: (item: T) => boolean): T[] {
  if (!enabled) return [...items];
  return [...items.filter(item => !complete(item)), ...items.filter(complete)];
}

/** Missing timestamps are legacy items: preserve their known sequence before dated items. */
export function automaticOrder<T extends { createdAt?: string; creationOrder?: number }>(items: readonly T[], complete: (item: T) => boolean): T[] {
  const created = items.map((item, index) => ({ item, index })).sort((a, b) => {
    const aTime = Date.parse(a.item.createdAt ?? ''), bTime = Date.parse(b.item.createdAt ?? '');
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime || a.index - b.index;
    if (Number.isFinite(aTime)) return 1;
    if (Number.isFinite(bTime)) return -1;
    return (a.item.creationOrder ?? a.index) - (b.item.creationOrder ?? b.index);
  }).map(entry => entry.item);
  return completionOrder(created, true, complete);
}
