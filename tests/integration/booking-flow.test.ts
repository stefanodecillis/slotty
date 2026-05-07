/**
 * End-to-end booking lifecycle (without HTTP):
 *   create → manage page lookup → reschedule → cancel.
 *
 * Google calendar I/O is mocked at the wrapper layer.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking } from '@/lib/booking/create';
import { cancelBooking } from '@/lib/booking/cancel';
import { rescheduleBooking } from '@/lib/booking/reschedule';
import { verifyBookingToken } from '@/lib/booking/tokens';

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

async function setup() {
  const { db } = await import('@/lib/db');
  const user = await db.user.create({
    data: {
      username: `e2e-${randomBytes(4).toString('hex')}`,
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
      title: 'E2E Booking',
      slug: `e2e-${randomBytes(4).toString('hex')}`,
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
  return { user, account, calendar, eventType };
}

describe('booking lifecycle end-to-end', () => {
  it('create → reschedule → cancel writes correct history and calls Google in the right order', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await setup();

    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({
      id: 'g-evt-1',
      hangoutLink: 'https://meet.google.com/abc',
    } as never);
    const patchSpy = spyOn(gcal, 'patchEvent').mockResolvedValue({
      id: 'g-evt-1',
      hangoutLink: 'https://meet.google.com/abc',
    } as never);
    const deleteSpy = spyOn(gcal, 'deleteEvent').mockResolvedValue(undefined);
    cleanups.push(() => insertSpy.mockRestore());
    cleanups.push(() => patchSpy.mockRestore());
    cleanups.push(() => deleteSpy.mockRestore());

    // 1. Create
    const created = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdayAt(10).toISOString(),
      bookerName: 'Booker',
      bookerEmail: 'booker@example.com',
      bookerTimezone: 'UTC',
    });
    expect(created.booking.status).toBe('confirmed');
    expect(created.booking.googleEventId).toBe('g-evt-1');
    expect(created.booking.meetingUrl).toBe('https://meet.google.com/abc');
    expect(insertSpy).toHaveBeenCalledTimes(1);

    // 2. Token verification
    expect(verifyBookingToken(created.booking, created.rawCancelToken)).toBe('cancel');
    expect(verifyBookingToken(created.booking, created.rawRescheduleToken)).toBe('reschedule');

    // 3. Reschedule
    const rescheduled = await rescheduleBooking({
      bookingId: created.booking.id,
      newStartAtIso: nextWeekdayAt(11).toISOString(),
      actor: 'booker',
    });
    expect(rescheduled.booking.status).toBe('confirmed');
    expect(rescheduled.booking.startAt.getTime()).not.toBe(created.booking.startAt.getTime());
    expect(patchSpy).toHaveBeenCalledTimes(1);

    // The Meet link is preserved (we didn't rotate it).
    expect(rescheduled.booking.meetingUrl).toBe('https://meet.google.com/abc');

    // 4. Cancel
    const cancelled = await cancelBooking({
      bookingId: created.booking.id,
      actor: 'booker',
      reason: 'plans changed',
    });
    expect(cancelled.booking.status).toBe('cancelled');
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // History contains created + rescheduled + cancelled.
    const history = await db.bookingHistory.findMany({
      where: { bookingId: created.booking.id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = history.map((h) => h.action);
    expect(actions).toEqual(['created', 'rescheduled', 'cancelled']);
  });

  it('booking is locally created even when Google insert fails', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await setup();

    const insertSpy = spyOn(gcal, 'insertEvent').mockRejectedValue(new Error('upstream 500'));
    cleanups.push(() => insertSpy.mockRestore());

    const created = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdayAt(10).toISOString(),
      bookerName: 'Offline',
      bookerEmail: 'offline@example.com',
      bookerTimezone: 'UTC',
    });
    expect(created.needsSync).toBe(true);

    // Manage URL still works (the booker still has their tokens).
    const reloaded = await db.booking.findUnique({ where: { id: created.booking.id } });
    expect(reloaded?.needsSync).toBe(true);
    expect(verifyBookingToken(reloaded!, created.rawRescheduleToken)).toBe('reschedule');
  });
});
