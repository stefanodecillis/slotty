import { describe, it, expect, beforeAll } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_DATABASE_URL ??= 'file:./test.db';
});

describe('validatePasswordStrength', () => {
  it('rejects passwords shorter than 12 chars', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('Aa1!short');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/12 characters/);
  });

  it('rejects passwords without an uppercase letter', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('alllowercase1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/uppercase/i);
  });

  it('rejects passwords without a lowercase letter', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('ALLUPPERCASE1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/lowercase/i);
  });

  it('rejects passwords without a digit', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('NoDigitsHereXX');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/digit/i);
  });

  it('rejects common passwords (case-insensitive)', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('Password1234');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too common/i);
  });

  it('accepts a strong password', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('CorrectHorseBattery9');
    expect(r.ok).toBe(true);
  });
});

describe('argon2 hash/verify', () => {
  it('round-trips a valid password', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
    const hash = await hashPassword('CorrectHorseBattery9');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'CorrectHorseBattery9')).toBe(true);
  }, 10_000);

  it('rejects the wrong password', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/auth/password');
    const hash = await hashPassword('CorrectHorseBattery9');
    expect(await verifyPassword(hash, 'WrongHorseBattery9')).toBe(false);
  }, 10_000);

  it('verifyPassword returns false on malformed hash instead of throwing', async () => {
    const { verifyPassword } = await import('@/lib/auth/password');
    expect(await verifyPassword('not-a-valid-hash', 'whatever')).toBe(false);
  });
});
