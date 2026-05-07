/**
 * Booking creation pipeline tests.
 *
 * Google calendar I/O is mocked at the wrapper layer (`insertEvent`) via
 * `spyOn` since Bun's fetch routes around the Node http hooks `nock` patches.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking, BookingError } from '@/lib/booking/create';
import { hashPassword } from '@/lib/auth/password';

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

interface SeedOpts {
  password?: string;
  durationMinutes?: number;
  locationKind?: 'google_meet' | 'phone' | 'in_person' | 'custom_link';
  locationValue?: string | null;
}

async function seed(opts: SeedOpts = {}) {
  const { db } = await import('@/lib/db');

  const user = await db.user.create({
    data: {
      username: `book-${randomBytes(4).toString('hex')}`,
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
    data: {
      userId: user.id,
      name: 'Default',
      isDefault: true,
      timezone: 'UTC',
    },
  });

  // Mon-Fri 09:00–17:00 UTC.
  for (const w of [1, 2, 3, 4, 5]) {
    await db.scheduleRule.create({
      data: {
        scheduleId: schedule.id,
        weekday: w,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      },
    });
  }

  const passwordHash = opts.password ? await hashPassword(opts.password) : null;

  const eventType = await db.eventType.create({
    data: {
      userId: user.id,
      title: 'Booking Test',
      slug: `book-${randomBytes(4).toString('hex')}`,
      durationMinutes: opts.durationMinutes ?? 30,
      destinationAccountId: account.id,
      destinationCalendarId: calendar.id,
      locationKind: opts.locationKind ?? 'google_meet',
      locationValue: opts.locationValue ?? null,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      minNoticeMin: 0,
      bookingWindowDays: 60,
      slotIntervalMin: 15,
      scheduleId: schedule.id,
      passwordHash,
      sendReminders: true,
      hidden: false,
      archived: false,
      position: 0,
    },
  });

  return { user, account, calendar, schedule, eventType };
}

/**
 * Pick a future "valid" slot start by anchoring the next available Tuesday at
 * 10:00 UTC. The test schedule covers Mon-Fri 09:00–17:00 UTC so 10:00 always
 * falls inside availability when the date is at least one day in the future.
 */
function nextWeekdaySlot(): Date {
  const now = DateTime.utc();
  // Move to the upcoming Tuesday (or 2 days out, whichever is later) at 10:00.
  let target = now.plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (target.weekday < 1 || target.weekday > 5) {
    target = target.plus({ days: 1 });
  }
  return target.toJSDate();
}

describe('createBooking happy path', () => {
  it('creates a booking, calls Google insertEvent, and stores meetingUrl', async () => {
    const { eventType } = await seed({ locationKind: 'google_meet' });

    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({
      id: 'g-event-123',
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      htmlLink: 'https://calendar.google.com/event?eid=xxx',
    } as never);
    cleanups.push(() => insertSpy.mockRestore());

    const startAt = nextWeekdaySlot();
    const result = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: startAt.toISOString(),
      bookerName: 'Alice',
      bookerEmail: 'alice@example.com',
      bookerTimezone: 'UTC',
    });

    expect(result.idempotentReplay).toBe(false);
    expect(result.needsSync).toBe(false);
    expect(result.booking.googleEventId).toBe('g-event-123');
    expect(result.booking.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(result.rawCancelToken.length).toBeGreaterThan(20);
    expect(result.rawRescheduleToken.length).toBeGreaterThan(20);
    expect(insertSpy).toHaveBeenCalled();
  });

  it('writes a BookingHistory entry on create', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await seed();
    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({ id: 'g-1' } as never);
    cleanups.push(() => insertSpy.mockRestore());

    const result = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Bob',
      bookerEmail: 'bob@example.com',
      bookerTimezone: 'UTC',
    });

    const history = await db.bookingHistory.findMany({ where: { bookingId: result.booking.id } });
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe('created');
    expect(history[0]!.actor).toBe('booker');
  });
});

describe('createBooking idempotency', () => {
  it('returns the existing booking when called twice with the same clientRequestId', async () => {
    const { eventType } = await seed();

    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({
      id: 'g-event-1',
      hangoutLink: 'https://meet.google.com/aaa',
    } as never);
    cleanups.push(() => insertSpy.mockRestore());

    const startAt = nextWeekdaySlot().toISOString();
    const clientRequestId = `cri-${randomBytes(4).toString('hex')}`;

    const a = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: startAt,
      bookerName: 'Carol',
      bookerEmail: 'carol@example.com',
      bookerTimezone: 'UTC',
      clientRequestId,
    });
    const b = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: startAt,
      bookerName: 'Carol',
      bookerEmail: 'carol@example.com',
      bookerTimezone: 'UTC',
      clientRequestId,
    });

    expect(a.idempotentReplay).toBe(false);
    expect(b.idempotentReplay).toBe(true);
    expect(b.booking.id).toBe(a.booking.id);
    // Google should have been called exactly once.
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe('createBooking slot re-check', () => {
  it('rejects a startAt that is not a valid candidate', async () => {
    const { eventType } = await seed();
    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({ id: 'g-1' } as never);
    cleanups.push(() => insertSpy.mockRestore());

    // Pick a Sunday — outside the Mon-Fri schedule.
    const sunday = DateTime.utc().plus({ days: 7 }).set({
      weekday: 7, // Sunday in luxon (1=Mon, 7=Sun)
      hour: 10,
      minute: 0,
      second: 0,
      millisecond: 0,
    });

    let err: unknown;
    try {
      await createBooking({
        eventTypeSlug: eventType.slug,
        startAtIso: sunday.toJSDate().toISOString(),
        bookerName: 'Dave',
        bookerEmail: 'dave@example.com',
        bookerTimezone: 'UTC',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe('SLOT_UNAVAILABLE');
    // Google must not be called when slot validation fails.
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe('createBooking Google failure', () => {
  it('still creates a booking and marks needsSync=true on Google insert failure', async () => {
    const { db } = await import('@/lib/db');
    const { eventType } = await seed();

    const insertSpy = spyOn(gcal, 'insertEvent').mockRejectedValue(new Error('boom'));
    cleanups.push(() => insertSpy.mockRestore());

    const result = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Erin',
      bookerEmail: 'erin@example.com',
      bookerTimezone: 'UTC',
    });

    expect(result.needsSync).toBe(true);
    expect(result.booking.needsSync).toBe(true);
    expect(result.booking.syncError).toBeTruthy();

    // A retry job should have been enqueued.
    const jobs = await db.job.findMany({ where: { kind: 'booking_sync_retry' } });
    expect(jobs).toHaveLength(1);
  });
});

describe('createBooking password gate', () => {
  it('rejects with PASSWORD_REQUIRED when the event type is gated and no password is provided', async () => {
    const { eventType } = await seed({ password: 'super-secret-1234' });
    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({ id: 'g-1' } as never);
    cleanups.push(() => insertSpy.mockRestore());

    let err: unknown;
    try {
      await createBooking({
        eventTypeSlug: eventType.slug,
        startAtIso: nextWeekdaySlot().toISOString(),
        bookerName: 'Frank',
        bookerEmail: 'frank@example.com',
        bookerTimezone: 'UTC',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe('PASSWORD_REQUIRED');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects with PASSWORD_INVALID on a wrong password', async () => {
    const { eventType } = await seed({ password: 'super-secret-1234' });
    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({ id: 'g-1' } as never);
    cleanups.push(() => insertSpy.mockRestore());

    let err: unknown;
    try {
      await createBooking({
        eventTypeSlug: eventType.slug,
        startAtIso: nextWeekdaySlot().toISOString(),
        bookerName: 'Frank',
        bookerEmail: 'frank@example.com',
        bookerTimezone: 'UTC',
        password: 'wrong',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BookingError);
    expect((err as BookingError).code).toBe('PASSWORD_INVALID');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('accepts a correct password and books', async () => {
    const password = 'super-secret-1234';
    const { eventType } = await seed({ password });
    const insertSpy = spyOn(gcal, 'insertEvent').mockResolvedValue({ id: 'g-1' } as never);
    cleanups.push(() => insertSpy.mockRestore());

    const result = await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'Grace',
      bookerEmail: 'grace@example.com',
      bookerTimezone: 'UTC',
      password,
    });
    expect(result.booking.id).toBeDefined();
  });
});

describe('createBooking location handling', () => {
  it('passes locationValue through for in_person', async () => {
    const { eventType } = await seed({ locationKind: 'in_person', locationValue: '123 Main St' });

    let captured: unknown;
    const insertSpy = spyOn(gcal, 'insertEvent').mockImplementation(async (...args: unknown[]) => {
      captured = args[2];
      return { id: 'g-1' } as never;
    });
    cleanups.push(() => insertSpy.mockRestore());

    await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'H',
      bookerEmail: 'h@example.com',
      bookerTimezone: 'UTC',
    });

    expect((captured as { location?: string }).location).toBe('123 Main St');
    expect((captured as { conferenceData?: unknown }).conferenceData).toBeUndefined();
  });

  it('requests conferenceData for google_meet', async () => {
    const { eventType } = await seed({ locationKind: 'google_meet' });

    let captured: unknown;
    const insertSpy = spyOn(gcal, 'insertEvent').mockImplementation(async (...args: unknown[]) => {
      captured = args[2];
      return { id: 'g-1', hangoutLink: 'https://meet.google.com/x' } as never;
    });
    cleanups.push(() => insertSpy.mockRestore());

    await createBooking({
      eventTypeSlug: eventType.slug,
      startAtIso: nextWeekdaySlot().toISOString(),
      bookerName: 'I',
      bookerEmail: 'i@example.com',
      bookerTimezone: 'UTC',
    });

    const cd = (captured as { conferenceData?: { createRequest?: unknown } }).conferenceData;
    expect(cd?.createRequest).toBeDefined();
  });
});
