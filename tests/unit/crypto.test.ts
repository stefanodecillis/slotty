import { describe, it, expect, beforeAll } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_DATABASE_URL ??= 'file:./test.db';
});

describe('crypto', () => {
  it('round-trips encryption with AES-256-GCM', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const plaintext = 'sk-very-secret-token-12345';
    const blob = encrypt(plaintext);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob.split('.')).toHaveLength(4);
    expect(decrypt(blob)).toBe(plaintext);
  });

  it('rejects tampered ciphertext (auth tag mismatch)', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const blob = encrypt('hello');
    const parts = blob.split('.');
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], ct.toString('base64')].join('.');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('rejects truncated blob', async () => {
    const { decrypt } = await import('@/lib/crypto');
    expect(() => decrypt('v1.abc.def')).toThrow();
  });

  it('generateToken returns matching hash', async () => {
    const { generateToken, hashToken } = await import('@/lib/crypto');
    const { token, hash } = generateToken();
    expect(hash).toBe(hashToken(token));
  });
});
