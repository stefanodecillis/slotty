/**
 * Tests for the daily BookingInvite retention sweep.
 *
 * Verifies:
 *   1. Invites past the cutoff in any terminal state (used / revoked /
 *      expired-unused) are deleted.
 *   2. Pending or recently-terminal invites are kept.
 *   3. After the invite delete pass, one-time EventTypes that are now
 *      orphaned (no invites at all) are also dropped; multi-invite one-time
 *      types (none of those exist in practice but the predicate must be safe)
 *      and normal EventTypes are untouched.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { pruneOldBookingInvites, RETENTION_DAYS } from '@/lib/jobs/prune-invites';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
  await db.bookingInvite.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.user.deleteMany({});
});

async function seedScaffold() {
  const { db } = await import('@/lib/db');
  const user = await db.user.create({
    data: {
      username: `prune-${randomBytes(4).toString('hex')}`,
      passwordHash: 'x',
      email: 'p@example.com',
      displayName: 'P',
      timezone: 'UTC',
    },
  });
  const account = await db.connectedAccount.create({
    data: {
      provider: 'google',
      googleUserEmail: `acc-${randomBytes(4).toString('hex')}@example.com`,
      accessTokenEnc: 'x',
      refreshTokenEnc: 'x',
      scopes: 'calendar',
      expiresAt: new Date(Date.now() + 3600_000),
      status: 'active',
    },
  });
  const calendar = await db.calendar.create({
    data: {
      connectedAccountId: account.id,
      googleCalendarId: `cal-${randomBytes(4).toString('hex')}`,
      name: 'Cal',
      isDestinationEligible: true,
    },
  });
  return { user, account, calendar };
}

async function makeEventType(
  userId: string,
  accountId: string,
  calendarId: string,
  opts: { isOneTime?: boolean } = {},
) {
  const { db } = await import('@/lib/db');
  return db.eventType.create({
    data: {
      userId,
      title: `Test ${randomBytes(2).toString('hex')}`,
      slug: `s-${randomBytes(4).toString('hex')}`,
      durationMinutes: 30,
      destinationAccountId: accountId,
      destinationCalendarId: calendarId,
      locationKind: 'google_meet',
      isOneTime: opts.isOneTime ?? false,
    },
  });
}

describe('pruneOldBookingInvites', () => {
  it('deletes invites past the cutoff in every terminal state, keeps pending and recent ones', async () => {
    const { db } = await import('@/lib/db');
    const { user, account, calendar } = await seedScaffold();
    const et = await makeEventType(user.id, account.id, calendar.id);

    const now = new Date('2026-06-01T00:00:00Z');
    const old = new Date(now.getTime() - (RETENTION_DAYS + 10) * MS_PER_DAY); // 100 days ago
    const recent = new Date(now.getTime() - 30 * MS_PER_DAY);

    const aUsedOld = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, usedAt: old },
    });
    const bUsedRecent = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, usedAt: recent },
    });
    const cRevokedOld = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, revokedAt: old },
    });
    const dExpiredOldUnused = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, expiresAt: old },
    });
    const ePending = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: `h-${randomBytes(4).toString('hex')}` },
    });
    // Expired but recently (within retention window) — should be kept.
    const fExpiredRecent = await db.bookingInvite.create({
      data: { eventTypeId: et.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, expiresAt: recent },
    });

    const result = await pruneOldBookingInvites(now);
    expect(result.deletedInvites).toBe(3);

    const remaining = await db.bookingInvite.findMany({
      where: { id: { in: [aUsedOld.id, bUsedRecent.id, cRevokedOld.id, dExpiredOldUnused.id, ePending.id, fExpiredRecent.id] } },
      select: { id: true },
    });
    const remainingIds = new Set(remaining.map((r) => r.id));
    expect(remainingIds.has(aUsedOld.id)).toBe(false);
    expect(remainingIds.has(cRevokedOld.id)).toBe(false);
    expect(remainingIds.has(dExpiredOldUnused.id)).toBe(false);
    expect(remainingIds.has(bUsedRecent.id)).toBe(true);
    expect(remainingIds.has(ePending.id)).toBe(true);
    expect(remainingIds.has(fExpiredRecent.id)).toBe(true);
  });

  it('drops orphan one-time EventTypes (all invites pruned) but keeps multi-invite ones and never touches normal EventTypes', async () => {
    const { db } = await import('@/lib/db');
    const { user, account, calendar } = await seedScaffold();

    const now = new Date('2026-06-01T00:00:00Z');
    const old = new Date(now.getTime() - (RETENTION_DAYS + 10) * MS_PER_DAY);

    // One-time EventType X: only an old used invite → invite pruned → orphan → EventType pruned.
    const x = await makeEventType(user.id, account.id, calendar.id, { isOneTime: true });
    await db.bookingInvite.create({
      data: { eventTypeId: x.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, usedAt: old },
    });

    // One-time EventType Y: old used invite + a still-pending one → Y survives because invite remains.
    const y = await makeEventType(user.id, account.id, calendar.id, { isOneTime: true });
    await db.bookingInvite.create({
      data: { eventTypeId: y.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, usedAt: old },
    });
    await db.bookingInvite.create({
      data: { eventTypeId: y.id, tokenHash: `h-${randomBytes(4).toString('hex')}` }, // pending
    });

    // Normal EventType Z (multi-invite, isOneTime=false): even with its only invite gone,
    // it must NOT be touched by this sweep.
    const z = await makeEventType(user.id, account.id, calendar.id, { isOneTime: false });
    await db.bookingInvite.create({
      data: { eventTypeId: z.id, tokenHash: `h-${randomBytes(4).toString('hex')}`, usedAt: old },
    });

    const result = await pruneOldBookingInvites(now);
    expect(result.deletedInvites).toBe(3);
    expect(result.deletedEventTypes).toBe(1);

    expect(await db.eventType.findUnique({ where: { id: x.id } })).toBeNull();
    expect(await db.eventType.findUnique({ where: { id: y.id } })).not.toBeNull();
    expect(await db.eventType.findUnique({ where: { id: z.id } })).not.toBeNull();
  });
});
