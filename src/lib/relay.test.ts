import { beforeEach, expect, it } from 'vitest';
import { loadRelay, saveRelay, provisionSharedRelay } from './relay';
beforeEach(() => localStorage.clear());
const shared = { url: 'https://example.test', token: 'synthetic' };
it('connects an unconfigured laptop to the provisioned relay', () => {
  expect(provisionSharedRelay(shared)).toBe(true);
  expect(loadRelay()).toEqual(shared);
});
it('keeps an explicit device connection or disconnect', () => {
  saveRelay({ url: '', token: '' });
  expect(provisionSharedRelay(shared)).toBe(false);
  expect(loadRelay()).toEqual({ url: '', token: '' });
  saveRelay({ url: 'https://other.test', token: 'other' });
  expect(provisionSharedRelay(shared)).toBe(false);
  expect(loadRelay().url).toBe('https://other.test');
});
