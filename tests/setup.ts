/**
 * Bun test preload. Runs once before any test file.
 *
 * - Provides safe defaults for required env vars so importing @/lib/env doesn't
 *   throw in unit tests that don't otherwise touch a real configuration.
 * - For DB-backed tests, creates a single shared SQLite file under the OS temp
 *   directory and runs the Prisma migrations against it. The Prisma client is
 *   a module-level singleton that reads SLOTTY_DATABASE_URL only at first
 *   construction — so setting it here, before any test imports @/lib/db,
 *   ensures every test sees the same migrated DB.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');

if (!process.env.SLOTTY_TEST_DB_READY) {
  const dir = mkdtempSync(join(tmpdir(), 'slotty-test-'));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dbFile = join(dir, 'test.db');
  process.env.SLOTTY_DATABASE_URL = `file:${dbFile}`;

  const result = spawnSync('bunx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, SLOTTY_DATABASE_URL: `file:${dbFile}` },
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    const stdout = result.stdout?.toString() ?? '';
    throw new Error(`prisma migrate deploy failed:\n${stdout}\n${stderr}`);
  }
  process.env.SLOTTY_TEST_DB_READY = '1';
}
