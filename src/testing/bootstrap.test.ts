import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); vi.resetModules(); });
afterEach(() => { delete window.milestoneTesting; vi.unstubAllEnvs(); localStorage.clear(); });

it('seeds only test quest/project stores and leaves existing test edits intact', async () => {
  vi.stubEnv('MODE', 'testing');
  const quest = JSON.stringify({ state: { questlines: [{ id: 'copied' }], routines: [] }, version: 0 });
  window.milestoneTesting = { seed: { quest } };
  await import('./bootstrap');
  expect(localStorage.getItem('milestone-v1')).toBe(quest);
  expect(localStorage.getItem('milestone-ui')).toBeNull();
  const changed = JSON.stringify({ state: { questlines: [{ id: 'test-edit' }] } });
  localStorage.setItem('milestone-v1', changed);
  vi.resetModules();
  await import('./bootstrap');
  expect(localStorage.getItem('milestone-v1')).toBe(changed);
});

it('never seeds production storage', async () => {
  vi.stubEnv('MODE', 'production');
  window.milestoneTesting = { seed: { quest: JSON.stringify({ state: { questlines: [{ id: 'test' }] } }) } };
  await import('./bootstrap');
  expect(localStorage.length).toBe(0);
});

it('refreshes changed production snapshots, backs up test edits and preserves vitals', async () => {
  vi.stubEnv('MODE', 'testing');
  const old = JSON.stringify({ state: { questlines: [{ id: 'test-edit' }] } });
  const fresh = JSON.stringify({ state: { questlines: [{ id: 'current' }] } });
  localStorage.setItem('milestone-v1', old);
  localStorage.setItem('milestone-testing-life-vitals-v2', 'custom-vitals');
  window.milestoneTesting = { seed: { quest: fresh, revision: 'new-snapshot' } };
  await import('./bootstrap');
  expect(localStorage.getItem('milestone-v1')).toBe(fresh);
  expect(JSON.parse(localStorage.getItem('milestone-testing-before-refresh')!).quest).toBe(old);
  expect(localStorage.getItem('milestone-testing-life-vitals-v2')).toBe('custom-vitals');
  localStorage.setItem('milestone-v1', old);
  vi.resetModules();
  await import('./bootstrap');
  expect(localStorage.getItem('milestone-v1')).toBe(old);
});
