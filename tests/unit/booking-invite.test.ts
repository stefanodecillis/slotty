/**
 * One-time invite link tests.
 *
 * Cover the four properties that matter for correctness:
 *   1. A valid invite books once → the invite flips to `used` and the
 *      Booking row references it.
 *   2. Reusing the same token returns INVITE_UNAVAILABLE (410); revoked
 *      and expired tokens behave identically.
 *   3. inviteOnly EventTypes reject slug-based access with INVITE_ONLY (404).
 *   4. Race: two concurrent createBooking calls against the same valid
 *      invite race for the same slot. Exactly one booking is created;
 *      the loser's booking row is rolled back (no orphan).
 *
 * Google Calendar I/O is mocked at the wrapper layer like the other booking
 * tests — the invite logic lives entirely above the Google insert anyway.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking, BookingError } from '@/lib/booking/create';
import { generateToken } from '@/lib/crypto';

const cleanups: Array<() => void> = [];

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
  await db.bookingInvite.deleteMany({});
  await db.booking.deleteMany({});
  await db.job.deleteMany({});
  await db.busyEvent.deleteMany({});
  await db.dateOverride.deleteMany({});
  await db.scheduleRule.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.schedule.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

interface SeedOpts {
  inviteOnly?: boolean;
  hidden?: boolean;
}

async function seed(opts: SeedOpts = {}) {
  const { db } = await import('@/lib/db');

  const user = await db.user.create({
    data: {
      username: `inv-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'owner@example.com',
      displayName: 'Owner',
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
      googleCalendarId: `cal-${randomBytes(4).toString('hex')}@group.calendar.google.com`,
      name: 'Cal',
      isDestinationEligible: true,
      isBusySource: true,
      timezone: 'UTC',
    },
  });

  const schedule = await db.schedule.create({
    data: { userId: user.id, name: 'Default', isDefault: true, timezone: 'UTC' },
  });

  for (const w of [1, 2, 3, 4, 5]) {
    await db.scheduleRule.create({
      data: { scheduleId: schedule.id, weekday: w, startMinute: 9 * 60, endMinute: 17 * 60 },
    });
  }

  const eventType = await db.eventType.create({
    data: {
      userId: user.id,
      title: 'Invite Test',
      slug: `inv-${randomBytes(4).toString('hex')}`,
      durationMinutes: 30,
      destinationAccountId: account.id,
      destinationCalendarId: calendar.id,
      locationKind: 'google_meet',
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      minNoticeMin: 0,
      bookingWindowDays: 60,
      slotIntervalMin: 15,
      maxGuests: 3,
      scheduleId: schedule.id,
      sendReminders: true,
      hidden: opts.hidden ?? true,
      inviteOnly: opts.inviteOnly ?? true,
      archived: false,
      position: 0,
    },
  });

  return { user, account, calendar, schedule, eventType };
}

async function createInvite(
  eventTypeId: string,
  overrides: { revokedAt?: Date | null; expiresAt?: Date | null; usedAt?: Date | null } = {},
) {
  const { db } = await import('@/lib/db');
  const { token, hash } = generateToken(32);
  const invite = await db.bookingInvite.create({
    data: {
      eventTypeId,
      tokenHash: hash,
      revokedAt: overrides.revokedAt ?? null,
      expiresAt: overrides.expiresAt ?? null,
      usedAt: overrides.usedAt ?? null,
    },
  });
  return { invite, rawToken: token };
}

function nextWeekdaySlot(): Date {
  const now = DateTime.utc();
  let target = now.plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (target.weekday < 1 || target.weekday > 5) {
    target = target.plus({ days: 1 });
  }
  return target.toJSDate();
}

function mockInsertEventOk(seed = 'g-event-123') {
  const insertSpy = spyOn(gcal, 'insertEvent').mockImplementation(async () =>
    ({ id: `${seed}-${randomBytes(2).toString('hex')}`, hangoutLink: 'https://meet.google.com/abc' }) as never,
  );
  cleanups.push(() => insertSpy.mockRestore());
}

describe('createBooking via invite token', () => {
  it('books once, then claims the invite and stores the back-reference', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await seed();
    const { invite, rawToken } = await createInvite(eventType.id);
    mockInsertEventOk();

    const result = await createBooking({
      inviteToken: rawToken,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Alice',
      bookerEmail: 'alice@example.com',
      bookerTimezone: 'UTC',
    });

    expect(result.idempotentReplay).toBe(false);

    const claimed = await db.bookingInvite.findUnique({ where: { id: invite.id } });
    expect(claimed?.usedAt).toBeTruthy();
    expect(claimed?.usedByBookingId).toBe(result.booking.id);
  });

  it('rejects re-use of the same token with INVITE_UNAVAILABLE (410)', async () => {
    const { eventType } = await seed();
    const { rawToken } = await createInvite(eventType.id);
    mockInsertEventOk();

    await createBooking({
      inviteToken: rawToken,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Alice',
      bookerEmail: 'alice@example.com',
      bookerTimezone: 'UTC',
    });

    await expect(
      createBooking({
        inviteToken: rawToken,
        // Different slot — to prove rejection isn't due to slot conflict.
        startAtIso: DateTime.fromJSDate(nextWeekdaySlot()).plus({ hours: 1 }).toJSDate().toISOString(),
        bookerName: 'Bob',
        bookerEmail: 'bob@example.com',
        bookerTimezone: 'UTC',
      }),
    ).rejects.toMatchObject({
      name: 'BookingError',
      code: 'INVITE_UNAVAILABLE',
      httpStatus: 410,
    });
  });

  it('rejects revoked invites with INVITE_UNAVAILABLE', async () => {
    const { eventType } = await seed();
    const { rawToken } = await createInvite(eventType.id, { revokedAt: new Date() });

    await expect(
      createBooking({
        inviteToken: rawToken,
        startAtIso: nextWeekdaySlot().toISOString(),
        bookerName: 'Alice',
        bookerEmail: 'alice@example.com',
        bookerTimezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_UNAVAILABLE', httpStatus: 410 });
  });

  it('rejects expired invites with INVITE_UNAVAILABLE', async () => {
    const { eventType } = await seed();
    const { rawToken } = await createInvite(eventType.id, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      createBooking({
        inviteToken: rawToken,
        startAtIso: nextWeekdaySlot().toISOString(),
        bookerName: 'Alice',
        bookerEmail: 'alice@example.com',
        bookerTimezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_UNAVAILABLE', httpStatus: 410 });
  });

  it('rejects unknown tokens with INVITE_NOT_FOUND (404)', async () => {
    const { eventType } = await seed();
    void eventType; // seed gates the rest of the lookup chain — token isn't in db.

    await expect(
      createBooking({
        inviteToken: 'nope-not-a-real-token',
        startAtIso: nextWeekdaySlot().toISOString(),
        bookerName: 'Alice',
        bookerEmail: 'alice@example.com',
        bookerTimezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND', httpStatus: 404 });
  });
});

describe('createBooking enforces inviteOnly via slug', () => {
  it('rejects slug-based booking on an inviteOnly event with INVITE_ONLY (404)', async () => {
    const { eventType } = await seed({ inviteOnly: true });

    await expect(
      createBooking({
        eventTypeSlug: eventType.slug,
        startAtIso: nextWeekdaySlot().toISOString(),
        bookerName: 'Alice',
        bookerEmail: 'alice@example.com',
        bookerTimezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_ONLY', httpStatus: 404 });
  });
});

describe('createBooking invite race', () => {
  it('exactly one of two concurrent bookings against the same invite succeeds', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await seed();
    const { invite, rawToken } = await createInvite(eventType.id);
    mockInsertEventOk();

    // Stagger the second call by one tick so both have entered resolveInviteByRawToken
    // and seen status=ok before either has reached the transaction. SQLite then
    // serializes the inner UPDATE so exactly one wins.
    const slotA = nextWeekdaySlot().toISOString();
    const slotB = DateTime.fromISO(slotA).plus({ hours: 1 }).toUTC().toISO()!;

    const results = await Promise.allSettled([
      createBooking({
        inviteToken: rawToken,
        startAtIso: slotA,
        bookerName: 'Alice',
        bookerEmail: 'alice@example.com',
        bookerTimezone: 'UTC',
      }),
      createBooking({
        inviteToken: rawToken,
        startAtIso: slotB,
        bookerName: 'Bob',
        bookerEmail: 'bob@example.com',
        bookerTimezone: 'UTC',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe('INVITE_UNAVAILABLE');

    // Loser's booking insert was rolled back — exactly one Booking row exists.
    const bookings = await db.booking.findMany({ where: { eventTypeId: eventType.id } });
    expect(bookings).toHaveLength(1);

    // Invite reflects the winning booking, not both.
    const claimed = await db.bookingInvite.findUnique({ where: { id: invite.id } });
    expect(claimed?.usedByBookingId).toBe(bookings[0]!.id);
  });
});

describe('hidden guests merge into the booking', () => {
  it('merges event-type defaults, invite-specific guests, and booker-typed guests; dedupes; excludes booker email', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await seed();

    // Set event-type-level hidden guests.
    await db.eventType.update({
      where: { id: eventType.id },
      data: {
        hiddenGuestsJson: JSON.stringify(['ops@example.com', 'cto@example.com']),
      },
    });

    // Create an invite with its own hidden list (one new, one duplicating the
    // event-type list, and one matching the booker — should be dropped).
    const { token, hash } = generateToken(32);
    const invite = await db.bookingInvite.create({
      data: {
        eventTypeId: eventType.id,
        tokenHash: hash,
        hiddenGuestsJson: JSON.stringify(['cc@example.com', 'ops@example.com', 'alice@example.com']),
      },
    });
    mockInsertEventOk();

    const result = await createBooking({
      inviteToken: token,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Alice',
      bookerEmail: 'alice@example.com',
      bookerTimezone: 'UTC',
      // Booker types one of their own + one that duplicates the event default.
      additionalGuests: ['friend@example.com', 'CTO@example.com'],
    });

    const booking = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    const merged = JSON.parse(booking.additionalGuestsJson) as string[];
    // Booker-typed entries come first (preserving their input order), then
    // event-type defaults, then invite-specific. Case-insensitive dedupe.
    // alice@example.com (booker) is dropped from invite-hidden.
    expect(merged).toEqual([
      'friend@example.com',
      'CTO@example.com',
      'ops@example.com',
      'cc@example.com',
    ]);

    // Sanity: invite still exists and is now used.
    const claimed = await db.bookingInvite.findUnique({ where: { id: invite.id } });
    expect(claimed?.usedAt).toBeTruthy();
  });

  it('still merges event-type hidden guests when booking via slug (no invite)', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await seed({ inviteOnly: false, hidden: false });

    await db.eventType.update({
      where: { id: eventType.id },
      data: { hiddenGuestsJson: JSON.stringify(['silent@example.com']) },
    });
    mockInsertEventOk();

    const result = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Alice',
      bookerEmail: 'alice@example.com',
      bookerTimezone: 'UTC',
    });

    const booking = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
    const merged = JSON.parse(booking.additionalGuestsJson) as string[];
    expect(merged).toEqual(['silent@example.com']);
  });
});
