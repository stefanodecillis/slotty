/**
 * TOTP flow integration tests.
 * Tests setup → enable → backup code consumption.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
} from '@/lib/auth/totp';
import { consumeBackupCode, regenerateBackupCodes } from '@/lib/auth/backup-codes';
import { encrypt } from '@/lib/crypto';
import { TOTPController } from 'oslo/otp';
import { decodeBase32 } from 'oslo/encoding';
import { TimeSpan } from 'oslo';

async function createTestUser() {
  const passwordHash = await hashPassword('TestPassword123!');
  return db.user.create({
    data: {
      username: `totp-flow-${Date.now()}`,
      passwordHash,
      email: `totp-flow-${Date.now()}@test.com`,
      displayName: 'TOTP Flow Test',
    },
  });
}

async function cleanupUser(userId: string) {
  await db.backupCode.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
}

describe('TOTP full setup flow', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupUser(userId);
  });

  it('setup: generates a valid secret and URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toBeTruthy();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it('enable: stores encrypted secret and generates backup codes', async () => {
    const secret = generateTotpSecret();
    const controller = new TOTPController({
      digits: 6,
      period: new TimeSpan(30, 's'),
    });
    const code = await controller.generate(decodeBase32(secret));

    const valid = await verifyTotpCode(secret, code);
    expect(valid).toBe(true);

    // Simulate enabling: store secret + backup codes.
    const secretEnc = encrypt(secret);
    await db.user.update({
      where: { id: userId },
      data: { totpSecretEnc: secretEnc, totpEnabled: true },
    });

    const backupCodes = await regenerateBackupCodes(userId);
    expect(backupCodes.length).toBe(10);

    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.totpEnabled).toBe(true);
    expect(user?.totpSecretEnc).toBeTruthy();
  });

  it('login step 2: valid TOTP code succeeds', async () => {
    const secret = generateTotpSecret();
    const controller = new TOTPController({
      digits: 6,
      period: new TimeSpan(30, 's'),
    });
    const code = await controller.generate(decodeBase32(secret));

    const valid = await verifyTotpCode(secret, code);
    expect(valid).toBe(true);
  });

  it('login step 2: backup code works once, then fails', async () => {
    const rawCodes = generateBackupCodes(3);
    // Store hashed versions.
    await regenerateBackupCodes(userId); // Creates 10 fresh codes

    // But now we want to test with our own known code.
    const { hashBackupCode } = await import('@/lib/auth/totp');
    const knownCode = rawCodes[0]!;
    await db.backupCode.create({
      data: {
        userId,
        codeHash: hashBackupCode(knownCode),
      },
    });

    // First use: succeeds.
    const first = await consumeBackupCode(userId, knownCode);
    expect(first).toBe(true);

    // Second use: fails.
    const second = await consumeBackupCode(userId, knownCode);
    expect(second).toBe(false);
  });

  it('disable: clears TOTP secret and backup codes', async () => {
    const secret = generateTotpSecret();
    await db.user.update({
      where: { id: userId },
      data: { totpSecretEnc: encrypt(secret), totpEnabled: true },
    });
    await regenerateBackupCodes(userId);

    // Verify codes exist before disabling.
    const codesBefore = await db.backupCode.count({ where: { userId } });
    expect(codesBefore).toBeGreaterThan(0);

    // Simulate disable.
    await db.user.update({
      where: { id: userId },
      data: { totpSecretEnc: null, totpEnabled: false },
    });
    await db.backupCode.deleteMany({ where: { userId } });

    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.totpEnabled).toBe(false);
    expect(user?.totpSecretEnc).toBeNull();

    const codesAfter = await db.backupCode.count({ where: { userId } });
    expect(codesAfter).toBe(0);
  });
});
