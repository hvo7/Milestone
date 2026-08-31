/**
 * The retry that stands between a dropped request and a blank app.
 *
 * The claim under test is narrow and worth pinning: a page chunk that fails once
 * must still open, and one that is genuinely gone must hand over to the recovery
 * above it rather than silently resolving to nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadWithRetry } from './lazyChunk';

/** A loader that fails its first `failures` calls, then succeeds. */
function flaky(failures: number, value = 'loaded') {
  let calls = 0;
  const load = vi.fn(async () => {
    calls++;
    if (calls <= failures) throw new Error('Failed to fetch dynamically imported module');
    return value;
  });
  return load;
}

// Zero pause: the widening delay is behaviour for a real network, not something
// these should sit through.
const fast = { delayMs: 0, onExhausted: () => false };

describe('loading a route chunk', () => {
  it('returns the module when the network cooperates', async () => {
    const load = flaky(0);
    await expect(loadWithRetry(load, fast)).resolves.toBe('loaded');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('survives a dropped request', async () => {
    const load = flaky(1);
    await expect(loadWithRetry(load, fast)).resolves.toBe('loaded');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps trying up to the limit', async () => {
    const load = flaky(2);
    await expect(loadWithRetry(load, fast)).resolves.toBe('loaded');
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('when the chunk is not coming', () => {
  it('gives up rather than hanging, and reports the real failure', async () => {
    const load = flaky(99);
    await expect(loadWithRetry(load, fast)).rejects.toThrow('Failed to fetch dynamically imported module');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('asks for the last-resort recovery exactly once', async () => {
    const onExhausted = vi.fn(() => false);
    await expect(loadWithRetry(flaky(99), { delayMs: 0, onExhausted })).rejects.toThrow();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('does not touch it while a retry might still work', async () => {
    const onExhausted = vi.fn(() => false);
    await expect(loadWithRetry(flaky(1), { delayMs: 0, onExhausted })).resolves.toBe('loaded');
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('honours a shorter attempt budget', async () => {
    const load = flaky(99);
    await expect(loadWithRetry(load, { ...fast, attempts: 1 })).rejects.toThrow();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
