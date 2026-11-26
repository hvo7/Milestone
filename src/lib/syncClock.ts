/**
 * Vector clocks: a count per device id, bumped on a device's own entry when it
 * publishes and merged (max per entry) when it takes in another's changes.
 * Comparing two answers whether one copy has seen everything the other has.
 */
export type Clock = Record<string, number>;
export type ClockRelation = 'ahead' | 'behind' | 'equal' | 'concurrent';

const at = (clock: Clock, key: string) => clock[key] ?? 0;

export function compareClocks(a: Clock, b: Clock): ClockRelation {
  let ahead = false, behind = false;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (at(a, key) > at(b, key)) ahead = true;
    else if (at(a, key) < at(b, key)) behind = true;
  }
  return ahead && behind ? 'concurrent' : ahead ? 'ahead' : behind ? 'behind' : 'equal';
}

export function mergeClocks(a: Clock, b: Clock): Clock {
  const out: Clock = { ...a };
  for (const key of Object.keys(b)) out[key] = Math.max(at(a, key), at(b, key));
  return out;
}
