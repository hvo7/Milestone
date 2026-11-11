import { describe, expect, it } from 'vitest';
import { factorPace, getPace, migrateLegacy, validAreas, type Factor, type LifeArea } from './lifeVitals';
const factor: Factor = { id: '1', name: 'Study', kind: 'progress', unit: 'hours', actual: 3, expected: 4, target: 8, tolerance: 0, assessment: 'unrated', criteria: '', included: true };
const area = (factors: Factor[]): LifeArea => ({ id: '1', name: 'My area', icon: 'projects', intention: '', period: '', factors, next: '', note: '' });
describe('custom life area assessments', () => {
  it('compares to expected progress rather than the final goal', () => {
    expect(factorPace({ ...factor, actual: 4 })).toBe('on-pace');
    expect(factorPace({ ...factor, actual: 5 })).toBe('ahead');
    expect(factorPace(factor)).toBe('behind');
  });
  it('reverses comparisons for limits and includes tolerance boundaries', () => {
    expect(factorPace({ ...factor, kind: 'limit' })).toBe('ahead');
    expect(factorPace({ ...factor, kind: 'limit', actual: 5 })).toBe('behind');
    expect(factorPace({ ...factor, tolerance: 1 })).toBe('on-pace');
    expect(factorPace({ ...factor, actual: .3, expected: .1, tolerance: .2 })).toBe('on-pace');
  });
  it('does not conceal a neglected factor with successes elsewhere', () => {
    expect(getPace(area([factor, { ...factor, id: '2', actual: 100 }]))).toBe('behind');
    expect(getPace(area([{ ...factor, included: false }, { ...factor, id: '2', actual: 100 }]))).toBe('ahead');
    expect(getPace(area([{ ...factor, actual: 4 }, { ...factor, id: '2', actual: 5 }]))).toBe('on-pace');
  });
  it('distinguishes missing check-ins from zero and supports subjective criteria', () => {
    expect(factorPace({ ...factor, actual: null })).toBe('unrated');
    expect(factorPace({ ...factor, actual: 0 })).toBe('behind');
    expect(factorPace({ ...factor, kind: 'manual', assessment: 'ahead' })).toBe('ahead');
    expect(getPace(area([]))).toBe('unrated');
    expect(getPace(area([{ ...factor, actual: null }, { ...factor, id: '2', actual: 5 }]))).toBe('unrated');
  });
  it('validates empty storage and rejects invalid numbers and duplicate factors', () => {
    expect(validAreas([])).toBe(true);
    expect(validAreas([area([factor])])).toBe(true);
    expect(validAreas([area([{ ...factor, actual: NaN }])])).toBe(false);
    expect(validAreas([area([factor, factor])])).toBe(false);
    expect(migrateLegacy(null)).toEqual([]);
    expect(migrateLegacy([{ id: 'old', name: 'Gym', icon: 'gym', intention: '', done: 2, expected: 2, target: 4, unit: 'workouts', next: '', note: '', assessment: 'auto' }])[0].factors[0].actual).toBe(2);
  });
});
