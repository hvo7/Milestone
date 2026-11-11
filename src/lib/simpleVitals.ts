import type { AreaIcon, Pace } from './lifeVitals';
import { loadLifeVitals } from './lifeVitalsStorage';

export type VitalCheck = { id: string; label: string; done: boolean };
export type SimpleVital = {
  id: string; name: string; icon: AreaIcon; checks: VitalCheck[];
  extra: boolean; checkedAt: string | null; archived?: boolean;
};
export const simpleVitalsKey = (testing: boolean) => testing
  ? 'milestone-testing-simple-vitals-v1' : 'milestone-simple-vitals-v1';

export function simplePace(area: SimpleVital): Pace {
  if (!area.checkedAt || !area.checks.length) return 'unrated';
  if (area.checks.some(check => !check.done)) return 'behind';
  return area.extra ? 'ahead' : 'on-pace';
}

export function newVital(): SimpleVital {
  return { id: crypto.randomUUID(), name: '', icon: 'projects',
    checks: [{ id: crypto.randomUUID(), label: 'I did what I planned', done: false }],
    extra: false, checkedAt: null };
}

export function validSimpleVitals(value: unknown): value is SimpleVital[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set<string>();
  return value.every(area => {
    if (!area || typeof area !== 'object' || typeof area.id !== 'string' || !area.id || ids.has(area.id)) return false;
    ids.add(area.id);
    return typeof area.name === 'string' && area.name.trim().length > 0 && area.name.length <= 40 &&
      ['gym', 'school', 'work', 'projects', 'wellbeing', 'people'].includes(area.icon) &&
      typeof area.extra === 'boolean' && (area.archived === undefined || typeof area.archived === 'boolean') &&
      (area.checkedAt === null || (typeof area.checkedAt === 'string' && Number.isFinite(Date.parse(area.checkedAt)))) &&
      Array.isArray(area.checks) && area.checks.length >= 1 && area.checks.length <= 3 &&
      new Set(area.checks.map((check: VitalCheck) => check?.id)).size === area.checks.length &&
      area.checks.every((check: VitalCheck) => check && typeof check.id === 'string' && check.id.length > 0 &&
        typeof check.label === 'string' && check.label.trim().length > 0 && check.label.length <= 80 && typeof check.done === 'boolean');
  });
}

export function loadSimpleVitals(storage: Pick<Storage, 'getItem'>, testing: boolean): SimpleVital[] {
  const saved = storage.getItem(simpleVitalsKey(testing));
  if (saved !== null) {
    const parsed: unknown = JSON.parse(saved);
    if (!validSimpleVitals(parsed)) throw new Error('Invalid saved Life Vitals');
    return parsed;
  }
  // Preserve the old stores unchanged. Numeric targets cannot be translated into
  // meaningful yes/no questions, so carry names over with an unassessed baseline.
  const old = loadLifeVitals(storage, testing);
  return old.map(area => ({ id: area.id, name: area.name, icon: area.icon,
    archived: area.archived, extra: false, checkedAt: null,
    checks: [{ id: `${area.id}-baseline`, label: 'I did what I planned', done: false }] }));
}
