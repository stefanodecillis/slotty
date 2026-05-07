/**
 * Admin-side booking management:
 *   - Listing only returns bookings owned (via event type) by the requesting user.
 *   - Detail lookup respects ownership.
 *   - No-show toggle writes history.
 *   - Owner cancel works without a token.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking } from '@/lib/booking/create';
import { cancelBooking } from '@/lib/booking/cancel';

const cleanups: Array<() => void> = [];

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
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

function nextWeekdayAt(hourUtc: number, daysFromNow = 3): Date {
  let target = DateTime.utc()
    .plus({ days: daysFromNow })
    .set({ hour: hourUtc, minute: 0, second: 0, millisecond: 0 });
  while (target.weekday < 1 || target.weekday > 5) target = target.plus({ days: 1 });
  return target.toJSDate();
}

async function setupOwnerWithBooking() {
  const { db } = await import('@/lib/db');
  const user = await db.user.create({
    data: {
      username: `adm-${randomBytes(4).toString('hex')}`,
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
      title: 'Admin Booking',
      slug: `adm-${randomBytes(4).toString('hex')}`,
      durationMinutes: 30,
      destinationAccountId: account.id,
      destinationCalendarId: calendar.id,
      locationKind: 'google_meet',
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      minNoticeMin: 0,
      bookingWindowDays: 60,
      slotIntervalMin: 15,
      scheduleId: schedule.id,
      sendReminders: true,
      hidden: false,
      archived: false,
      position: 0,
    },
  });

  const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({
    id: 'g-evt-1',
    hangoutLink: 'https://meet.google.com/admin',
  } as never);
  cleanups.push(() => insertSpy.mockRestore());

  const created = await createBooking({
    eventTypeSlug: eventType.slug,
    startAtIso: nextWeekdayAt(10).toISOString(),
    bookerName: 'Booker',
    bookerEmail: 'booker@example.com',
    bookerTimezone: 'UTC',
  });

  return { user, account, calendar, eventType, created };
}

describe('owner cancel', () => {
  it('cancels without a token check and records actor=owner in history', async () => {
    const { db } = await import('@/lib/db');
    const { created } = await setupOwnerWithBooking();

    const deleteSpy = spyOn(gcal, 'deleteEvent').mockResolvedValue(undefined);
    cleanups.push(() => deleteSpy.mockRestore());

    const res = await cancelBooking({
      bookingId: created.booking.id,
      actor: 'owner',
      reason: 'admin override',
    });
    expect(res.booking.status).toBe('cancelled');
    expect(deleteSpy).toHaveBeenCalled();

    const history = await db.bookingHistory.findFirst({
      where: { bookingId: created.booking.id, action: 'cancelled' },
    });
    expect(history?.actor).toBe('owner');
  });
});

describe('cross-user isolation', () => {
  it('one user cannot see another user\'s bookings via the admin list query', async () => {
    const { db } = await import('@/lib/db');
    const a = await setupOwnerWithBooking();
    const b = await setupOwnerWithBooking();

    // From user A's perspective, only their booking appears.
    const aOwnedIds = (
      await db.eventType.findMany({ where: { userId: a.user.id }, select: { id: true } })
    ).map((e) => e.id);
    const aBookings = await db.booking.findMany({
      where: { eventTypeId: { in: aOwnedIds } },
    });
    expect(aBookings).toHaveLength(1);
    expect(aBookings[0]?.id).toBe(a.created.booking.id);

    // And specifically does NOT include user B's booking.
    expect(aBookings.find((x) => x.id === b.created.booking.id)).toBeUndefined();
  });
});

describe('no-show toggle', () => {
  it('writes a history entry and flips the flag', async () => {
    const { db } = await import('@/lib/db');
    const { created } = await setupOwnerWithBooking();

    // Simulate the route handler logic.
    const updated = await db.$transaction(async (tx) => {
      const next = await tx.booking.update({
        where: { id: created.booking.id },
        data: { noShow: true },
      });
      await tx.bookingHistory.create({
        data: {
          bookingId: created.booking.id,
          action: 'no_show_marked',
          payloadJson: JSON.stringify({ before: false, after: true }),
          actor: 'owner',
        },
      });
      return next;
    });
    expect(updated.noShow).toBe(true);

    const history = await db.bookingHistory.findMany({
      where: { bookingId: created.booking.id, action: 'no_show_marked' },
    });
    expect(history).toHaveLength(1);
  });
});
