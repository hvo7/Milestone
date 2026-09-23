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
