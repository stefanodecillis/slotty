/**
 * Booking reschedule pipeline tests.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking } from '@/lib/booking/create';
import { cancelBooking } from '@/lib/booking/cancel';
import {
  rescheduleBooking,
  BookingAlreadyCancelledError,
  SlotUnavailableError,
} from '@/lib/booking/reschedule';

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

function nextWeekdayAt(hourUtc: number): Date {
  let target = DateTime.utc()
    .plus({ days: 3 })
    .set({ hour: hourUtc, minute: 0, second: 0, millisecond: 0 });
  while (target.weekday < 1 || target.weekday > 5) target = target.plus({ days: 1 });
  return target.toJSDate();
}

async function seedWithBooking() {
  const { db } = await import('@/lib/db');

  const user = await db.user.create({
    data: {
      username: `r-${randomBytes(4).toString('hex')}`,
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
      title: 'Reschedule Test',
      slug: `r-${randomBytes(4).toString('hex')}`,
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
    hangoutLink: 'https://meet.google.com/orig',
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

describe('rescheduleBooking', () => {
  it('reschedules to a valid slot and patches Google without conferenceData', async () => {
    const { db } = await import('@/lib/db');
    const { created } = await seedWithBooking();

    let patchPayload: unknown;
    const patchSpy = spyOn(gcal, 'patchEvent').mockImplementation(async (...args: unknown[]) => {
      patchPayload = args[3];
      return { id: 'g-evt-1' } as never;
    });
    cleanups.push(() => patchSpy.mockRestore());

    const newStart = nextWeekdayAt(11);
    const result = await rescheduleBooking({
      bookingId: created.booking.id,
      newStartAtIso: newStart.toISOString(),
      actor: 'booker',
    });

    expect(result.booking.status).toBe('confirmed');
    expect(result.booking.startAt.toISOString()).toBe(newStart.toISOString());
    expect(patchSpy).toHaveBeenCalled();
    // The patch payload must NOT include conferenceData (so Meet link is preserved).
    expect((patchPayload as { conferenceData?: unknown })?.conferenceData).toBeUndefined();

    const history = await db.bookingHistory.findMany({
      where: { bookingId: created.booking.id, action: 'rescheduled' },
    });
    expect(history).toHaveLength(1);
  });

  it('rejects rescheduling to a slot that is not available', async () => {
    const { created } = await seedWithBooking();
    const patchSpy = spyOn(gcal, 'patchEvent').mockResolvedValue({ id: 'g-evt-1' } as never);
    cleanups.push(() => patchSpy.mockRestore());

    // A Sunday slot — outside the schedule.
    const sunday = DateTime.utc().plus({ days: 7 }).set({
      weekday: 7,
      hour: 10,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    let err: unknown;
    try {
      await rescheduleBooking({
        bookingId: created.booking.id,
        newStartAtIso: sunday.toJSDate().toISOString(),
        actor: 'booker',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SlotUnavailableError);
    // Google must not be patched.
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('refuses to reschedule a cancelled booking', async () => {
    const { created } = await seedWithBooking();

    const deleteSpy = spyOn(gcal, 'deleteEvent').mockResolvedValue(undefined);
    cleanups.push(() => deleteSpy.mockRestore());
    await cancelBooking({ bookingId: created.booking.id, actor: 'booker' });

    const patchSpy = spyOn(gcal, 'patchEvent').mockResolvedValue({ id: 'g-evt-1' } as never);
    cleanups.push(() => patchSpy.mockRestore());

    let err: unknown;
    try {
      await rescheduleBooking({
        bookingId: created.booking.id,
        newStartAtIso: nextWeekdayAt(11).toISOString(),
        actor: 'booker',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BookingAlreadyCancelledError);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('flips status back to confirmed after Google patch succeeds', async () => {
    const { db } = await import('@/lib/db');
    const { created } = await seedWithBooking();
    const patchSpy = spyOn(gcal, 'patchEvent').mockResolvedValue({ id: 'g-evt-1' } as never);
    cleanups.push(() => patchSpy.mockRestore());

    await rescheduleBooking({
      bookingId: created.booking.id,
      newStartAtIso: nextWeekdayAt(11).toISOString(),
      actor: 'booker',
    });

    const reloaded = await db.booking.findUnique({ where: { id: created.booking.id } });
    expect(reloaded?.status).toBe('confirmed');
    expect(reloaded?.needsSync).toBe(false);
  });
});
