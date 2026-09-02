/**
 * The device identity, on the origin the phone actually gets the app from.
 *
 * The Wi-Fi bridge serves over plain http to a LAN address, which is not a
 * secure context — so the half of the crypto API that is gated on one simply
 * isn't there. That is not an exotic case: it is the normal way this app
 * reaches a phone, and identity() is on the path that sets up all syncing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { identity } from './phoneTransport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = globalThis.crypto;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true }); });

/** Replace the global crypto with one exposing only the listed members. */
function cryptoWith(members: Partial<Crypto>) {
  Object.defineProperty(globalThis, 'crypto', { value: members, configurable: true });
}

describe('minting a device id', () => {
  it('uses randomUUID where there is one', () => {
    cryptoWith({ randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(identity().deviceId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('still mints one over the Wi-Fi bridge, where randomUUID is not defined', () => {
    cryptoWith({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    const id = identity().deviceId;
    expect(id).toMatch(UUID);
  });

  it('mints something usable even with no crypto at all', () => {
    cryptoWith({});
    expect(identity().deviceId.length).toBeGreaterThan(8);
  });

  it('keeps the same id across calls — a new one each launch would look like a new device', () => {
    cryptoWith({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    const first = identity().deviceId;
    expect(identity().deviceId).toBe(first);
  });

  it('does not throw where the old code did', () => {
    cryptoWith({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    // The precise failure this guards: calling the gated member directly.
    expect(() => (globalThis.crypto as Crypto).randomUUID()).toThrow();
    expect(() => identity()).not.toThrow();
  });
});
