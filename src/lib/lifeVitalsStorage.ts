import { migrateLegacy, validAreas, type LifeArea } from './lifeVitals';
import { lifeVitalsExamples } from '../testing/lifeVitalsExamples';

export const lifeVitalsStorageKey = (testing: boolean) => testing ? 'milestone-testing-life-vitals-v2' : 'milestone-life-vitals-v1';

export function loadLifeVitals(storage: Pick<Storage, 'getItem'>, testing: boolean): LifeArea[] {
  try {
    const current = storage.getItem(lifeVitalsStorageKey(testing));
    if (current !== null) {
      const parsed: unknown = JSON.parse(current);
      if (!validAreas(parsed)) return [];
      return testing && parsed.length === 0 ? lifeVitalsExamples() : parsed;
    }
    if (!testing) return [];
    const legacy = migrateLegacy(JSON.parse(storage.getItem('milestone-testing-life-vitals-mock-v1') ?? 'null'));
    return legacy.length ? legacy : lifeVitalsExamples();
  } catch { return []; }
}
