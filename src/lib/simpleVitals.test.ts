import { describe, expect, it } from 'vitest';
import { loadSimpleVitals, newVital, simplePace, simpleVitalsKey, validSimpleVitals, type SimpleVital } from './simpleVitals';
import { lifeVitalsStorageKey } from './lifeVitalsStorage';
import { lifeVitalsExamples } from '../testing/lifeVitalsExamples';

const area = (): SimpleVital => ({ ...newVital(), name: 'Gym', checkedAt: '2026-11-09T12:00:00Z',
  checks: [{ id: 'lift', label: 'Did my workouts', done: false }, { id: 'walk', label: 'Stayed active', done: false }] });
const storage = (values: Record<string, string> = {}) => ({ getItem: (key: string) => values[key] ?? null });

describe('simple checkbox vitals', () => {
  it('distinguishes an untouched area from a saved check-in with no checks', () => {
    expect(simplePace({ ...area(), checkedAt: null })).toBe('unrated');
    expect(simplePace(area())).toBe('behind');
  });
  it('requires all basics for on pace and extra progress for ahead', () => {
    const a = area();
    a.checks[0].done = true;
    expect(simplePace(a)).toBe('behind');
    a.extra = true;
    expect(simplePace(a)).toBe('behind');
    a.checks[1].done = true;
    expect(simplePace(a)).toBe('ahead');
    a.extra = false;
    expect(simplePace(a)).toBe('on-pace');
  });
  it('allows one to three checks and rejects duplicate IDs or missing labels', () => {
    expect(validSimpleVitals([area()])).toBe(true);
    expect(validSimpleVitals([{ ...area(), checks: [] }])).toBe(false);
    expect(validSimpleVitals([{ ...area(), checks: Array.from({ length: 4 }, (_, i) => ({ id: String(i), label: 'A', done: false })) }])).toBe(false);
    expect(validSimpleVitals([{ ...area(), checks: [area().checks[0], area().checks[0]] }])).toBe(false);
    expect(validSimpleVitals([{ ...area(), checks: [{ id: 'x', label: ' ', done: false }] }])).toBe(false);
    expect(validSimpleVitals([{ ...area(), checkedAt: 'invalid' }])).toBe(false);
  });
  it('keeps production empty even when testing examples and checklists exist', () => {
    expect(loadSimpleVitals(storage({ [simpleVitalsKey(true)]: JSON.stringify([area()]), [lifeVitalsStorageKey(true)]: JSON.stringify(lifeVitalsExamples()) }), false)).toEqual([]);
  });
  it('preserves completed checks, extra progress, archived areas and saved empty lists', () => {
    const saved = [{ ...area(), extra: true, archived: true }];
    expect(loadSimpleVitals(storage({ [simpleVitalsKey(true)]: JSON.stringify(saved) }), true)).toEqual(saved);
    expect(loadSimpleVitals(storage({ [simpleVitalsKey(true)]: '[]' }), true)).toEqual([]);
  });
  it('carries old area names into an unassessed single-check setup without changing old data', () => {
    const old = lifeVitalsExamples();
    old[0].name = 'My strength training';
    const raw = JSON.stringify(old);
    const store = storage({ [lifeVitalsStorageKey(true)]: raw });
    const migrated = loadSimpleVitals(store, true);
    expect(migrated[0].name).toBe('My strength training');
    expect(migrated.every(a => a.checks.length === 1 && simplePace(a) === 'unrated')).toBe(true);
    expect(store.getItem(lifeVitalsStorageKey(true))).toBe(raw);
  });
  it('reports invalid saved data instead of silently replacing it', () => {
    expect(() => loadSimpleVitals(storage({ [simpleVitalsKey(true)]: 'broken' }), true)).toThrow();
    expect(() => loadSimpleVitals(storage({ [simpleVitalsKey(true)]: '[{}]' }), true)).toThrow();
  });
});
