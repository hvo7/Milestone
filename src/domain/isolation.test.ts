import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); });

it('domain imports do not read or write persisted application data', async () => {
  vi.resetModules();
  const read = vi.spyOn(Storage.prototype, 'getItem');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  await import('./schedule');
  await import('./taskState');
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
