export type Pace = 'behind' | 'on-pace' | 'ahead' | 'unrated';
export type AreaIcon = 'gym' | 'school' | 'work' | 'projects' | 'wellbeing' | 'people';
export type Factor = {
  id: string; name: string; kind: 'progress' | 'limit' | 'manual';
  unit: string; actual: number | null; expected: number; target: number; tolerance: number;
  assessment: Pace; criteria: string; included: boolean;
};
export type LifeArea = {
  id: string; name: string; icon: AreaIcon; intention: string; period: string;
  factors: Factor[]; next: string; note: string; archived?: boolean;
};
export const paceLabels: Record<Pace, string> = { behind: 'Behind', 'on-pace': 'On pace', ahead: 'Ahead', unrated: 'Not assessed' };
export function factorPace(factor: Factor): Pace {
  if (factor.kind === 'manual') return factor.assessment;
  if (factor.actual === null) return 'unrated';
  const delta = (factor.actual - factor.expected) * (factor.kind === 'limit' ? -1 : 1);
  if (Math.abs(delta) <= factor.tolerance + 1e-9) return 'on-pace';
  return delta > 0 ? 'ahead' : 'behind';
}
export function getPace(area: LifeArea): Pace {
  const statuses = area.factors.filter(f => f.included).map(factorPace);
  if (statuses.includes('behind')) return 'behind';
  if (!statuses.length || statuses.includes('unrated')) return 'unrated';
  return statuses.every(s => s === 'ahead') ? 'ahead' : 'on-pace';
}
export function newFactor(): Factor {
  return { id: crypto.randomUUID(), name: '', kind: 'progress', unit: '', actual: null, expected: 0, target: 1, tolerance: 0, assessment: 'unrated', criteria: '', included: true };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
const pace = (v: unknown) => text(v) && Object.hasOwn(paceLabels, v);
export function validAreas(v: unknown): v is LifeArea[] {
  return Array.isArray(v) && v.length <= 100 && new Set(v.map(a => a?.id)).size === v.length && v.every(a =>
    object(a) && ['id', 'name', 'intention', 'period', 'next', 'note'].every(k => text(a[k])) &&
    ['gym', 'school', 'work', 'projects', 'wellbeing', 'people'].includes(String(a.icon)) &&
    (a.archived === undefined || typeof a.archived === 'boolean') && Array.isArray(a.factors) && a.factors.length <= 30 &&
    new Set(a.factors.map(f => f?.id)).size === a.factors.length && a.factors.every(f =>
      object(f) && ['id', 'name', 'unit', 'criteria'].every(k => text(f[k])) &&
      ['progress', 'limit', 'manual'].includes(String(f.kind)) && (f.actual === null || number(f.actual)) &&
      number(f.expected) && number(f.target) && number(f.tolerance) && pace(f.assessment) && typeof f.included === 'boolean'));
}
export function migrateLegacy(v: unknown): LifeArea[] {
  if (!Array.isArray(v)) return [];
  const migrated = v.filter(a => object(a) && ['id', 'name', 'intention', 'unit', 'next', 'note'].every(k => text(a[k])) &&
    number(a.done) && number(a.target) && number(a.expected) && ['auto', 'behind', 'on-pace', 'ahead'].includes(String(a.assessment)))
    .map(a => ({ id: a.id, name: a.name, icon: a.icon, intention: a.intention, period: 'Previous example week', next: a.next, note: a.note,
      factors: [{ id: `${a.id}-legacy`, name: a.unit || 'Progress', unit: a.unit, actual: a.done, expected: a.expected, target: a.target,
        tolerance: 0, kind: a.assessment === 'auto' ? 'progress' : 'manual', assessment: a.assessment === 'auto' ? 'unrated' : a.assessment,
        criteria: '', included: true }] }));
  return validAreas(migrated) ? migrated : [];
}
