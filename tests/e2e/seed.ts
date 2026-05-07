/**
 * Standalone seed script for the e2e database. Invoked as a pre-step by
 * `bun run test:e2e` so the SQLite file exists *before* Playwright spawns
 * the production server (which would otherwise fail its health check on
 * its first DB query).
 *
 * Idempotent: runs `prisma migrate deploy` against the configured database
 * URL, then truncates and re-seeds the fixture rows.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { E2E_CONFIG } from '../../playwright.config';

const ROOT = resolve(__dirname, '../..');

function dbFilePath(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  return url.slice('file:'.length);
}

function runPrismaMigrate(databaseUrl: string): void {
  const result = spawnSync('bunx', ['prisma', 'migrate', 'deploy'], {
    cwd: ROOT,
    env: { ...process.env, SLOTTY_DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed (exit ${result.status})`);
  }
}

export async function seedE2eDatabase(opts: { resetFile?: boolean } = {}): Promise<void> {
  process.env.SLOTTY_PUBLIC_URL = E2E_CONFIG.baseUrl;
  process.env.SLOTTY_ENCRYPTION_KEY = E2E_CONFIG.encryptionKey;
  process.env.SLOTTY_SESSION_SECRET = E2E_CONFIG.sessionSecret;
  process.env.SLOTTY_DATABASE_URL = E2E_CONFIG.databaseUrl;
  process.env.SLOTTY_TRUST_PROXY = 'false';
  process.env.SLOTTY_GOOGLE_CLIENT_ID ??= 'test-client-id';
  process.env.SLOTTY_GOOGLE_CLIENT_SECRET ??= 'test-client-secret';

  const file = dbFilePath(E2E_CONFIG.databaseUrl);
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    // Only delete the file when explicitly requested. The Playwright webServer
    // starts BEFORE globalSetup, so unlinking the file out from under a running
    // Prisma client leaves it reading a deleted inode (classic Unix semantics)
    // and every subsequent query mismatches the freshly-seeded rows. Default to
    // truncating the tables instead.
    if (opts.resetFile && existsSync(file)) {
      rmSync(file);
      if (existsSync(`${file}-journal`)) rmSync(`${file}-journal`);
    }
  }

  runPrismaMigrate(E2E_CONFIG.databaseUrl);

  const { db: prisma } = await import('@/lib/db');
  const { hashPassword } = await import('@/lib/auth/password');
  const { encrypt } = await import('@/lib/crypto');

  const passwordHash = await hashPassword(E2E_CONFIG.adminPassword);

  await prisma.$transaction(async (tx) => {
    await tx.booking.deleteMany();
    await tx.eventTypeQuestion.deleteMany();
    await tx.eventType.deleteMany();
    await tx.scheduleRule.deleteMany();
    await tx.dateOverride.deleteMany();
    await tx.schedule.deleteMany();
    await tx.busyEvent.deleteMany();
    await tx.calendar.deleteMany();
    await tx.connectedAccount.deleteMany();
    await tx.session.deleteMany();
    await tx.loginAttempt.deleteMany();
    await tx.user.deleteMany();

    const user = await tx.user.create({
      data: {
        username: E2E_CONFIG.adminUsername,
        displayName: 'E2E Admin',
        email: 'admin@example.com',
        passwordHash,
        timezone: 'UTC',
        seedColor: '#4F6CFF',
      },
    });

    const account = await tx.connectedAccount.create({
      data: {
        provider: 'google',
        googleUserEmail: 'test@example.com',
        accessTokenEnc: encrypt('e2e-fake-access-token'),
        refreshTokenEnc: encrypt('e2e-fake-refresh-token'),
        scopes:
          'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        // Pre-expired so refresh attempts will fail; expected in e2e.
        expiresAt: new Date(Date.now() - 60_000),
        status: 'active',
      },
    });

    const calendar = await tx.calendar.create({
      data: {
        connectedAccountId: account.id,
        googleCalendarId: 'test@example.com',
        name: 'Test Primary Calendar',
        isPrimary: true,
        isBusySource: true,
        isDestinationEligible: true,
      },
    });

    const schedule = await tx.schedule.create({
      data: {
        userId: user.id,
        name: 'Working hours',
        isDefault: true,
        timezone: 'UTC',
      },
    });

    for (const weekday of [1, 2, 3, 4, 5]) {
      await tx.scheduleRule.create({
        data: {
          scheduleId: schedule.id,
          weekday,
          startMinute: 9 * 60,
          endMinute: 18 * 60,
        },
      });
    }

    await tx.eventType.create({
      data: {
        userId: user.id,
        title: 'E2E Quick chat',
        slug: 'quick-chat',
        descriptionMd: 'A 30-minute exploratory call.',
        durationMinutes: 30,
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        locationKind: 'google_meet',
        scheduleId: schedule.id,
        slotIntervalMin: 15,
        bookingWindowDays: 60,
        minNoticeMin: 60,
      },
    });
  });

  await prisma.$disconnect();
}

// `import.meta.main` is Bun-specific; on Node-driven imports (e.g., Playwright's
// own loader for globalSetup) the property is undefined and the block is a no-op.
const meta = import.meta as { main?: unknown };
if (typeof meta.main === 'boolean' && meta.main) {
  // We default to NOT resetting the file. Pass `--reset-file` to nuke it
  // (only do this when no webServer is currently holding the inode open —
  // otherwise Prisma will keep reading the stale, deleted inode and the
  // next write surfaces as "attempt to write a readonly database").
  const resetFile = process.argv.includes('--reset-file');
  seedE2eDatabase({ resetFile })
    .then(() => {
      console.log(`E2E database seeded${resetFile ? ' (file recreated)' : ''}.`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
