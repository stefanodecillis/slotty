/**
 * Webhook signing unit tests.
 */
import { describe, it, expect } from 'bun:test';
import { signPayload, verifySignature } from '@/lib/webhooks/sign';

describe('signPayload', () => {
  it('produces a deterministic signature with the same inputs', () => {
    const secret = 'test-secret-value';
    const body = JSON.stringify({ event: 'booking.created', data: {} });
    const timestamp = 1700000000;

    const sig1 = signPayload(secret, body, timestamp);
    const sig2 = signPayload(secret, body, timestamp);

    expect(sig1).toBe(sig2);
  });

  it('signature format is t=<ts>,v1=<hex>', () => {
    const sig = signPayload('secret', 'body', 1700000000);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('different secrets produce different signatures', () => {
    const body = 'test body';
    const timestamp = 1700000000;
    const sig1 = signPayload('secret1', body, timestamp);
    const sig2 = signPayload('secret2', body, timestamp);
    expect(sig1).not.toBe(sig2);
  });

  it('different bodies produce different signatures', () => {
    const secret = 'test-secret';
    const timestamp = 1700000000;
    const sig1 = signPayload(secret, 'body1', timestamp);
    const sig2 = signPayload(secret, 'body2', timestamp);
    expect(sig1).not.toBe(sig2);
  });
});

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    const secret = 'valid-secret';
    const body = '{"event":"booking.created"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signPayload(secret, body, timestamp);

    expect(verifySignature(secret, body, header)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const secret = 'valid-secret';
    const body = '{"event":"booking.created"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signPayload(secret, body, timestamp);
    const tamperedBody = '{"event":"booking.cancelled"}';

    expect(verifySignature(secret, tamperedBody, header)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const body = '{"event":"booking.created"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = signPayload('correct-secret', body, timestamp);

    expect(verifySignature('wrong-secret', body, header)).toBe(false);
  });

  it('rejects a stale timestamp outside tolerance', () => {
    const secret = 'test-secret';
    const body = 'body';
    // Timestamp 10 minutes in the past (beyond default 5-min tolerance).
    const oldTimestamp = Math.floor(Date.now() / 1000) - 700;
    const header = signPayload(secret, body, oldTimestamp);

    expect(verifySignature(secret, body, header, 300)).toBe(false);
  });

  it('accepts a timestamp within tolerance', () => {
    const secret = 'test-secret';
    const body = 'body';
    // Timestamp 2 minutes in the past.
    const recentTimestamp = Math.floor(Date.now() / 1000) - 120;
    const header = signPayload(secret, body, recentTimestamp);

    expect(verifySignature(secret, body, header, 300)).toBe(true);
  });

  it('rejects malformed header', () => {
    expect(verifySignature('secret', 'body', 'not-a-signature')).toBe(false);
    expect(verifySignature('secret', 'body', '')).toBe(false);
  });
});
