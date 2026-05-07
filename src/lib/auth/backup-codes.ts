/**
 * Backup code management for TOTP 2FA recovery.
 * Codes are SHA256-hashed in the database; single-use (atomic consume).
 */
import { db } from '@/lib/db';
import { generateBackupCodes, hashBackupCode } from './totp';

/**
 * Attempt to consume a backup code for the given user.
 * Returns true if a matching unused code was found and marked used.
 * Atomic: uses a transaction to prevent race conditions.
 */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const codeHash = hashBackupCode(code);

  return db.$transaction(async (tx) => {
    const found = await tx.backupCode.findFirst({
      where: {
        userId,
        codeHash,
        usedAt: null,
      },
    });

    if (!found) return false;

    await tx.backupCode.update({
      where: { id: found.id },
      data: { usedAt: new Date() },
    });

    return true;
  });
}

/**
 * Regenerate backup codes for a user.
 * Invalidates all existing codes and creates 10 new ones.
 * Returns the raw plain-text codes (shown once to the user).
 */
export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  const rawCodes = generateBackupCodes(10);

  await db.$transaction(async (tx) => {
    // Delete all existing backup codes for the user.
    await tx.backupCode.deleteMany({ where: { userId } });

    // Create new hashed codes.
    await tx.backupCode.createMany({
      data: rawCodes.map((code) => ({
        userId,
        codeHash: hashBackupCode(code),
      })),
    });
  });

  return rawCodes;
}
