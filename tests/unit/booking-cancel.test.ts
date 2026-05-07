/**
 * Booking cancel pipeline tests.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking } from '@/lib/booking/create';
import { cancelBooking } from '@/lib/booking/cancel';
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

async function seedWithBooking() {
  const { db } = await import('@/lib/db');

  const user = await db.user.create({
    data: {
      username: `c-${randomBytes(4).toString('hex')}`,
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
      title: 'Cancel Test',
      slug: `cnc-${randomBytes(4).toString('hex')}`,
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

  // Make the booking via createBooking with Google insert mocked.
  const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({
    id: 'g-evt-1',
    hangoutLink: 'https://meet.google.com/abc',
  } as never);
  cleanups.push(() => insertSpy.mockRestore());

  const startAt = DateTime.utc()
    .plus({ days: 3 })
    .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  // Snap to next weekday.
  let target = startAt;
  while (target.weekday < 1 || target.weekday > 5) target = target.plus({ days: 1 });

  const created = await createBooking({
    eventTypeSlug: eventType.slug,
    startAtIso: target.toJSDate().toISOString(),
    bookerName: 'Alice',
    bookerEmail: 'alice@example.com',
    bookerTimezone: 'UTC',
  });

  return { user, account, calendar, eventType, created };
}

describe('cancelBooking', () => {
  it('cancels a confirmed booking and writes history', async () => {
    const { db } = await import('@/lib/db');
    const { created } = await seedWithBooking();

    const deleteSpy = spyOn(gcal, 'deleteEvent').mockResolvedValue(undefined);
    cleanups.push(() => deleteSpy.mockRestore());

    const res = await cancelBooking({
      bookingId: created.booking.id,
      actor: 'booker',
      reason: 'no longer needed',
    });
    expect(res.alreadyCancelled).toBe(false);
    expect(res.booking.status).toBe('cancelled');
    expect(res.booking.cancelReason).toBe('no longer needed');
    expect(deleteSpy).toHaveBeenCalled();

    const history = await db.bookingHistory.findMany({
      where: { bookingId: created.booking.id, action: 'cancelled' },
    });
    expect(history).toHaveLength(1);
  });

  it('is idempotent on a second call', async () => {
    const { created } = await seedWithBooking();
    const deleteSpy = spyOn(gcal, 'deleteEvent').mockResolvedValue(undefined);
    cleanups.push(() => deleteSpy.mockRestore());

    const a = await cancelBooking({ bookingId: created.booking.id, actor: 'booker' });
    const b = await cancelBooking({ bookingId: created.booking.id, actor: 'booker' });
    expect(a.alreadyCancelled).toBe(false);
    expect(b.alreadyCancelled).toBe(true);
    // Google delete should have been called only on the first cancel.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('still cancels locally when Google deleteEvent fails', async () => {
    const { db } = await import('@/lib/db');
    const { created } = await seedWithBooking();
    const deleteSpy = spyOn(gcal, 'deleteEvent').mockRejectedValue(new Error('upstream down'));
    cleanups.push(() => deleteSpy.mockRestore());

    const res = await cancelBooking({ bookingId: created.booking.id, actor: 'booker' });
    expect(res.booking.status).toBe('cancelled');

    const reloaded = await db.booking.findUnique({ where: { id: created.booking.id } });
    expect(reloaded?.needsSync).toBe(true);
    expect(reloaded?.syncError).toContain('cancel:');
  });
});

describe('verifyBookingToken in cancel context', () => {
  it('rejects a cancel attempt with the wrong token', async () => {
    const { created } = await seedWithBooking();
    expect(verifyBookingToken(created.booking, 'definitely-not-the-token')).toBeNull();
  });

  it('accepts the cancel token', async () => {
    const { created } = await seedWithBooking();
    expect(verifyBookingToken(created.booking, created.rawCancelToken)).toBe('cancel');
  });

  it('accepts the reschedule token (which implicitly grants cancel)', async () => {
    const { created } = await seedWithBooking();
    expect(verifyBookingToken(created.booking, created.rawRescheduleToken)).toBe('reschedule');
  });
});
