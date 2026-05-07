import { describe, it, expect, beforeAll } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_DATABASE_URL ??= 'file:./test.db';
});

describe('validatePasswordStrength', () => {
  it('rejects an empty string', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/required/i);
  });

  it('rejects a whitespace-only string', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/required/i);
  });

  it('accepts a single-character password', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('a');
    expect(r.ok).toBe(true);
  });

  it('accepts a short alphanumeric password', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('hello');
    expect(r.ok).toBe(true);
  });

  it('accepts a password without uppercase letters', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('alllowercase');
    expect(r.ok).toBe(true);
  });

  it('accepts a password without digits', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('NoDigitsHereXX');
    expect(r.ok).toBe(true);
  });

  it('accepts a password shorter than 12 characters', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('Aa1!short');
    expect(r.ok).toBe(true);
  });

  it('rejects common passwords (case-insensitive)', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('password');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too common/i);
  });

  it('rejects common passwords regardless of case', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('PASSWORD');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too common/i);
  });

  it('rejects "123456" (common password)', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too common/i);
  });

  it('rejects "qwerty" (common password)', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('qwerty');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too common/i);
  });

  it('rejects passwords longer than 256 characters', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('a'.repeat(257));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/256/);
  });

  it('accepts a password of exactly 256 characters', async () => {
    const { validatePasswordStrength } = await import('@/lib/auth/password');
    const r = validatePasswordStrength('a'.repeat(256));
    expect(r.ok).toBe(true);
  });

  it('accepts a normal strong password', async () => {
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
