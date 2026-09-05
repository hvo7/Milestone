/**
 * The comparison that decides whether to replace the running application.
 *
 * Every case here is one where being wrong is invisible: the app simply goes on
 * being the version it was, which is indistinguishable from there being no
 * newer version — the exact failure the updater exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import semver from './semver.cjs';

const { isNewer } = semver;

describe('isNewer', () => {
  it('sees an ordinary patch bump', () => {
    expect(isNewer('3.0.4', '3.0.3')).toBe(true);
    expect(isNewer('3.1.0', '3.0.9')).toBe(true);
    expect(isNewer('4.0.0', '3.9.9')).toBe(true);
  });

  it('does not offer the version already running', () => {
    expect(isNewer('3.0.3', '3.0.3')).toBe(false);
  });

  it('never offers a downgrade', () => {
    expect(isNewer('3.0.2', '3.0.3')).toBe(false);
    expect(isNewer('2.9.9', '3.0.0')).toBe(false);
  });

  // The reason this file exists. Compared as strings, "3.0.10" < "3.0.9", so a
  // tenth patch release would never reach a single installed copy — and nothing
  // would report an error, because nothing would have gone wrong.
  it('compares numerically once a component reaches double digits', () => {
    expect(isNewer('3.0.10', '3.0.9')).toBe(true);
    expect(isNewer('3.0.9', '3.0.10')).toBe(false);
    expect(isNewer('3.10.0', '3.9.0')).toBe(true);
    expect(isNewer('10.0.0', '9.0.0')).toBe(true);
  });

  it('tolerates the tag form, since releases are named v3.0.4', () => {
    expect(isNewer('v3.0.4', '3.0.3')).toBe(true);
    expect(isNewer('3.0.4', 'v3.0.3')).toBe(true);
  });

  it('treats a missing or unreadable version as "leave the app alone"', () => {
    expect(isNewer('', '3.0.3')).toBe(false);
    expect(isNewer('3.0.4', '')).toBe(false);
    expect(isNewer(null, '3.0.3')).toBe(false);
    expect(isNewer(undefined, undefined)).toBe(false);
    expect(isNewer('not-a-version', '3.0.3')).toBe(false);
  });

  it('reads a short version as zero-padded rather than as garbage', () => {
    expect(isNewer('3.1', '3.0.9')).toBe(true);
    expect(isNewer('3', '3.0.0')).toBe(false);
  });
});
