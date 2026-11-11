import { describe, it, expect } from 'vitest';
import { loadLifeVitals, lifeVitalsStorageKey } from './lifeVitalsStorage';
import { validAreas } from './lifeVitals';
const storage = (values: Record<string, string> = {}) => ({ getItem: (key: string) => values[key] ?? null });
describe('Life Vitals example isolation', () => {
  it('prefills empty testing profiles with valid independent editable examples', () => {
    const first = loadLifeVitals(storage(), true);
    expect(first).toHaveLength(6);
    expect(validAreas(first)).toBe(true);
    first[0].factors[0].actual = 900;
    expect(loadLifeVitals(storage(), true)[0].factors[0].actual).toBe(1);
    expect(loadLifeVitals(storage({ [lifeVitalsStorageKey(true)]: '[]' }), true)).toHaveLength(6);
  });
  it('leaves production empty even when testing data is present', () => {
    const samples = JSON.stringify(loadLifeVitals(storage(), true));
    expect(loadLifeVitals(storage({ [lifeVitalsStorageKey(true)]: samples, 'milestone-testing-life-vitals-mock-v1': samples }), false)).toEqual([]);
    expect(loadLifeVitals(storage({ [lifeVitalsStorageKey(false)]: '[]' }), false)).toEqual([]);
  });
  it('preserves saved custom and archived areas', () => {
    const custom = loadLifeVitals(storage(), true).slice(0, 1);
    custom[0].name = 'My custom area'; custom[0].archived = true;
    for (const testing of [true, false]) {
      expect(loadLifeVitals(storage({ [lifeVitalsStorageKey(testing)]: JSON.stringify(custom) }), testing)).toEqual(custom);
    }
  });
  it('does not silently replace unreadable saved data with examples', () => {
    expect(loadLifeVitals(storage({ [lifeVitalsStorageKey(true)]: 'broken' }), true)).toEqual([]);
  });
});
