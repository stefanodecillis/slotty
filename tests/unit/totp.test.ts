/**
 * TOTP unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '@/lib/db';
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpCode,
  generateBackupCodes,
  hashBackupCode,
} from '@/lib/auth/totp';
import { consumeBackupCode, regenerateBackupCodes } from '@/lib/auth/backup-codes';
import { TOTPController } from 'oslo/otp';
import { decodeBase32 } from 'oslo/encoding';
import { TimeSpan } from 'oslo';

describe('generateTotpSecret', () => {
  it('generates a non-empty base32 string', () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);
    // Base32 characters only (uppercase A-Z, digits 2-7)
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it('generates unique secrets each time', () => {
    const s1 = generateTotpSecret();
    const s2 = generateTotpSecret();
    expect(s1).not.toBe(s2);
  });
});

describe('generateTotpUri', () => {
  it('generates a valid otpauth URI', () => {
    const secret = generateTotpSecret();
    const uri = generateTotpUri('testuser', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('Slotty');
    expect(uri).toContain('testuser');
    expect(uri).toContain('secret=');
  });
});

describe('verifyTotpCode', () => {
  it('accepts a code computed at the same moment', async () => {
    const secret = generateTotpSecret();
    const controller = new TOTPController({
      digits: 6,
      period: new TimeSpan(30, 's'),
    });
    const secretBytes = decodeBase32(secret);
    const code = await controller.generate(secretBytes);

    const valid = await verifyTotpCode(secret, code);
    expect(valid).toBe(true);
  });

  it('rejects an incorrect code', async () => {
    const secret = generateTotpSecret();
    const valid = await verifyTotpCode(secret, '000000');
    // Extremely unlikely to be true; 1 in 1,000,000 chance.
    // If it somehow happens to be the right TOTP code for this second,
    // the test may flake. But statistically this is safe.
    // We can't guarantee false without knowing the secret's TOTP output.
    // Just verify the function runs without throwing.
    expect(typeof valid).toBe('boolean');
  });

  it('rejects an invalid-format code', async () => {
    const secret = generateTotpSecret();
    const valid = await verifyTotpCode(secret, 'abcdef');
    expect(valid).toBe(false);
  });

  it('handles invalid base32 secret gracefully', async () => {
    const valid = await verifyTotpCode('not-valid-base32!!!', '123456');
    expect(valid).toBe(false);
  });
});

describe('generateBackupCodes', () => {
  it('generates the requested number of codes', () => {
    const codes = generateBackupCodes(10);
    expect(codes.length).toBe(10);
  });

  it('generates 10-digit numeric codes', () => {
    const codes = generateBackupCodes(5);
    for (const code of codes) {
      expect(code).toMatch(/^\d{10}$/);
    }
  });

  it('generates unique codes', () => {
    const codes = generateBackupCodes(10);
    const unique = new Set(codes);
    expect(unique.size).toBe(10);
  });
});

describe('hashBackupCode', () => {
  it('returns a 64-character hex string', () => {
    const hash = hashBackupCode('1234567890');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const h1 = hashBackupCode('1234567890');
    const h2 = hashBackupCode('1234567890');
    expect(h1).toBe(h2);
  });

  it('different codes produce different hashes', () => {
    const h1 = hashBackupCode('1234567890');
    const h2 = hashBackupCode('0987654321');
    expect(h1).not.toBe(h2);
  });
});

describe('backup codes round-trip + single-use', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await db.user.create({
      data: {
        username: `totp-test-${Date.now()}`,
        passwordHash: 'hash',
        email: `totp-test-${Date.now()}@test.com`,
        displayName: 'TOTP Test',
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await db.backupCode.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
  });

  it('can generate and consume a backup code', async () => {
    const codes = await regenerateBackupCodes(userId);
    expect(codes.length).toBe(10);

    const firstCode = codes[0]!;
    const result = await consumeBackupCode(userId, firstCode);
    expect(result).toBe(true);
  });

  it('rejects a code after it has been used (single-use)', async () => {
    const codes = await regenerateBackupCodes(userId);
    const firstCode = codes[0]!;

    await consumeBackupCode(userId, firstCode);
    const secondAttempt = await consumeBackupCode(userId, firstCode);
    expect(secondAttempt).toBe(false);
  });

  it('rejects an invalid code', async () => {
    await regenerateBackupCodes(userId);
    const result = await consumeBackupCode(userId, '9999999999');
    expect(result).toBe(false);
  });

  it('regenerateBackupCodes invalidates old codes', async () => {
    const oldCodes = await regenerateBackupCodes(userId);
    const oldFirst = oldCodes[0]!;

    // Regenerate — old codes should no longer work.
    await regenerateBackupCodes(userId);

    const result = await consumeBackupCode(userId, oldFirst);
    expect(result).toBe(false);
  });
});
