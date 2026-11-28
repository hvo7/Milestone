import { beforeEach, expect, it } from 'vitest';
import { loadRelay, saveRelay, provisionSharedRelay, setupCode, fromSetupCode } from './relay';
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


it('moves a relay connection as one pasteable setup code', () => {
  const config = { url: 'https://milestone-sync.example.workers.dev', token: 'a/b+c=d#e f' };
  const code = setupCode(config);
  expect(code.startsWith('https://milestone-sync.example.workers.dev#key=')).toBe(true);
  expect(fromSetupCode({ url: code, token: '' })).toEqual(config);
  // Typed separately, it is left alone.
  const typed = { url: 'https://relay.example', token: 'secret' };
  expect(fromSetupCode(typed)).toBe(typed);
});
