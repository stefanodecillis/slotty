/**
 * computeSlots: end-to-end algorithm tests.
 *
 * These tests use the real DB via @/lib/db (the same setup other availability
 * tests use). Each case seeds a minimal user / account / calendar / schedule
 * / event type, then asserts on the slot result.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import { computeSlots } from '@/lib/scheduling/compute';
import { invalidate as invalidateCache } from '@/lib/scheduling/cache';

interface Seeded {
  user: { id: string };
  eventType: import('@prisma/client').EventType;
  schedule: { id: string; timezone: string };
}

async function seed(opts: {
  schedule?: { rules?: { weekday: number; startMinute: number; endMinute: number }[]; tz?: string };
  eventType?: Partial<{
    durationMinutes: number;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    minNoticeMin: number;
    bookingWindowDays: number;
    slotIntervalMin: number;
    maxPerDay: number | null;
    maxPerWeek: number | null;
  }>;
} = {}): Promise<Seeded> {
  const { db } = await import('@/lib/db');

  const user = await db.user.create({
    data: {
      username: `slot-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'slot@example.com',
      displayName: 'Slot Owner',
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
      expiresAt: new Date(Date.now() + 3600 * 1000),
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
    },
  });

  const tz = opts.schedule?.tz ?? 'UTC';
  const rules = opts.schedule?.rules ?? [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 9 * 60,
    endMinute: 18 * 60,
  }));

  const schedule = await db.schedule.create({
    data: {
      userId: user.id,
      name: 'Default',
      isDefault: true,
      timezone: tz,
      rules: { create: rules.map((r) => ({ weekday: r.weekday, startMinute: r.startMinute, endMinute: r.endMinute })) },
    },
  });

  const et = opts.eventType ?? {};
  const eventType = await db.eventType.create({
    data: {
      userId: user.id,
      title: 'Test Event',
      slug: `slot-et-${randomBytes(4).toString('hex')}`,
      color: '#000000',
      hidden: false,
      durationMinutes: et.durationMinutes ?? 60,
      destinationAccountId: account.id,
      destinationCalendarId: calendar.id,
      locationKind: 'google_meet',
      bufferBeforeMin: et.bufferBeforeMin ?? 0,
      bufferAfterMin: et.bufferAfterMin ?? 0,
      minNoticeMin: et.minNoticeMin ?? 0,
      bookingWindowDays: et.bookingWindowDays ?? 60,
      slotIntervalMin: et.slotIntervalMin ?? 30,
      maxPerDay: et.maxPerDay ?? null,
      maxPerWeek: et.maxPerWeek ?? null,
      scheduleId: schedule.id,
      sendReminders: true,
    },
  });

  return { user, eventType, schedule };
}

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.busyEvent.deleteMany({});
  await db.bookingHistory.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.scheduleRule.deleteMany({});
  await db.dateOverride.deleteMany({});
  await db.schedule.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
  invalidateCache();
});

describe('computeSlots — happy path', () => {
  it('emits slots every 30min from 09:00 to 17:00 (60min duration, no buffer)', async () => {
    const { user, eventType } = await seed();

    // Wednesday 2026-05-06 — Mon-Fri 09-18 schedule.
    const from = DateTime.fromISO('2026-05-06T00:00:00Z').toJSDate();
    const to = DateTime.fromISO('2026-05-06T23:59:59Z').toJSDate();

    const result = await computeSlots({
      eventType,
      user: user as never,
      from,
      to,
      bookerTz: 'UTC',
      now: DateTime.fromISO('2026-05-01T00:00:00Z').toJSDate(),
      noCache: true,
    });

    expect(result.days.length).toBe(1);
    const day = result.days[0]!;
    // 09:00 .. 17:00 inclusive at 30-min steps = 17 starts.
    expect(day.slots.length).toBe(17);
    expect(day.slots[0]!.startInBookerTz).toBe('09:00');
    expect(day.slots[day.slots.length - 1]!.startInBookerTz).toBe('17:00');
  });
});

describe('computeSlots — busy events', () => {
  it('removes slots that overlap a midday busy event', async () => {
    const { user, eventType } = await seed();
    const { db } = await import('@/lib/db');

    const calendar = await db.calendar.findFirstOrThrow({});
    await db.busyEvent.create({
      data: {
        calendarId: calendar.id,
        googleEventId: 'busy-1',
        startAt: new Date('2026-05-06T12:00:00Z'),
        endAt: new Date('2026-05-06T13:00:00Z'),
        status: 'confirmed',
        transparency: 'opaque',
      },
    });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      noCache: true,
    });

    const labels = result.days[0]!.slots.map((s) => s.startInBookerTz);
    // 60min duration: a slot S overlaps busy [12:00,13:00) iff S in (11:00, 13:00).
    // So 11:30 and 12:00 and 12:30 are out; 11:00 ok (ends 12:00) and 13:00 ok.
    expect(labels).not.toContain('11:30');
    expect(labels).not.toContain('12:00');
    expect(labels).not.toContain('12:30');
    expect(labels).toContain('11:00');
    expect(labels).toContain('13:00');
  });

  it('an all-day busy event blocks every slot that day', async () => {
    const { user, eventType } = await seed();
    const { db } = await import('@/lib/db');

    const calendar = await db.calendar.findFirstOrThrow({});
    await db.busyEvent.create({
      data: {
        calendarId: calendar.id,
        googleEventId: 'busy-all-day',
        startAt: new Date('2026-05-06T00:00:00Z'),
        endAt: new Date('2026-05-07T00:00:00Z'),
        status: 'confirmed',
        transparency: 'opaque',
        isAllDay: true,
      },
    });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      noCache: true,
    });

    expect(result.days.length).toBe(0);
  });

  it('cancelled busy events are ignored', async () => {
    const { user, eventType } = await seed();
    const { db } = await import('@/lib/db');

    const calendar = await db.calendar.findFirstOrThrow({});
    await db.busyEvent.create({
      data: {
        calendarId: calendar.id,
        googleEventId: 'busy-cancelled',
        startAt: new Date('2026-05-06T12:00:00Z'),
        endAt: new Date('2026-05-06T13:00:00Z'),
        status: 'cancelled',
        transparency: 'opaque',
      },
    });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      noCache: true,
    });

    expect(result.days[0]!.slots.length).toBe(17);
  });

  it('transparent busy events are ignored', async () => {
    const { user, eventType } = await seed();
    const { db } = await import('@/lib/db');

    const calendar = await db.calendar.findFirstOrThrow({});
    await db.busyEvent.create({
      data: {
        calendarId: calendar.id,
        googleEventId: 'busy-transparent',
        startAt: new Date('2026-05-06T12:00:00Z'),
        endAt: new Date('2026-05-06T13:00:00Z'),
        status: 'confirmed',
        transparency: 'transparent',
      },
    });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      noCache: true,
    });

    expect(result.days[0]!.slots.length).toBe(17);
  });
});

describe('computeSlots — buffers', () => {
  it('15-min buffer-before excludes a 10:00 slot when 09:30-10:00 is busy', async () => {
    const { user, eventType } = await seed({ eventType: { bufferBeforeMin: 15 } });
    const { db } = await import('@/lib/db');

    const calendar = await db.calendar.findFirstOrThrow({});
    await db.busyEvent.create({
      data: {
        calendarId: calendar.id,
        googleEventId: 'busy-pre',
        startAt: new Date('2026-05-06T09:30:00Z'),
        endAt: new Date('2026-05-06T10:00:00Z'),
        status: 'confirmed',
        transparency: 'opaque',
      },
    });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      noCache: true,
    });

    const labels = result.days[0]!.slots.map((s) => s.startInBookerTz);
    expect(labels).not.toContain('10:00');
    // 10:30 needs free [10:15, 11:30) and busy is [9:30, 10:00) — no overlap, fine.
    expect(labels).toContain('10:30');
  });

  it('15-min buffer-after blocks a 10:00 slot when 11:00-11:15 is busy', async () => {
    const { user, eventType } = await seed({ eventType: { bufferAfterMin: 15 } });
    const { db } = await import('@/lib/db');

    const calendar = await db.calendar.findFirstOrThrow({});
    await db.busyEvent.create({
      data: {
        calendarId: calendar.id,
        googleEventId: 'busy-post',
        startAt: new Date('2026-05-06T11:00:00Z'),
        endAt: new Date('2026-05-06T11:15:00Z'),
        status: 'confirmed',
        transparency: 'opaque',
      },
    });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      noCache: true,
    });

    const labels = result.days[0]!.slots.map((s) => s.startInBookerTz);
    // 10:00 slot: protected [10:00, 11:15) overlaps busy 11:00-11:15 → blocked.
    expect(labels).not.toContain('10:00');
    // 09:30 slot: protected [09:30, 10:45) — no overlap; fine.
    expect(labels).toContain('09:30');
  });
});

describe('computeSlots — minNotice and bookingWindow', () => {
  it('minNoticeMin=120 with now=Wed 10:00 excludes slots before noon', async () => {
    const { user, eventType } = await seed({ eventType: { minNoticeMin: 120 } });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-06T10:00:00Z'),
      noCache: true,
    });

    const labels = result.days[0]!.slots.map((s) => s.startInBookerTz);
    expect(labels).not.toContain('10:00');
    expect(labels).not.toContain('11:00');
    expect(labels).not.toContain('11:30');
    expect(labels).toContain('12:00');
  });

  it('bookingWindowDays=7 truncates the response', async () => {
    const { user, eventType } = await seed({ eventType: { bookingWindowDays: 7 } });

    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-04T00:00:00Z'),
      to: new Date('2026-05-31T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-04T00:00:00Z'),
      noCache: true,
    });

    // With now=May 4 and window=7 days, the cutoff is May 11 00:00Z. So only
    // dates May 4..May 10 should appear (May 4-8 are weekdays, plus weekend
    // gap, and May 11 itself starts at the boundary).
    const dates = result.days.map((d) => d.date);
    expect(dates.every((d) => d <= '2026-05-11')).toBe(true);
    expect(dates).not.toContain('2026-05-12');
  });
});

describe('computeSlots — frequency caps', () => {
  it('maxPerDay=2 with two existing bookings drops the day', async () => {
    const { user, eventType } = await seed({ eventType: { maxPerDay: 2 } });

    const byDay = new Map([['2026-05-06', 2]]);
    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      bookingsCount: { byDay, byWeek: new Map() },
      noCache: true,
    });

    expect(result.days.length).toBe(0);
  });

  it('maxPerWeek caps slot output across the week', async () => {
    const { user, eventType } = await seed({ eventType: { maxPerWeek: 1 } });

    // ISO week for 2026-05-06 is 2026-W19 (Wed of that week).
    const byWeek = new Map([['2026-W19', 1]]);
    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-06T23:59:59Z'),
      bookerTz: 'UTC',
      now: new Date('2026-05-01T00:00:00Z'),
      bookingsCount: { byDay: new Map(), byWeek },
      noCache: true,
    });

    expect(result.days.length).toBe(0);
  });
});

describe('computeSlots — booker tz vs schedule tz', () => {
  it('Rome schedule, NY booker — slots are labelled in NY local time', async () => {
    const { user, eventType } = await seed({
      schedule: { tz: 'Europe/Rome' },
    });

    // Wednesday 2026-07-15. Rome 09-18 = UTC 07-16 (CEST). NY in July is EDT
    // (UTC-4), so 07-16 UTC = 03-12 NY.
    const result = await computeSlots({
      eventType,
      user: user as never,
      from: new Date('2026-07-15T00:00:00Z'),
      to: new Date('2026-07-15T23:59:59Z'),
      bookerTz: 'America/New_York',
      now: new Date('2026-07-01T00:00:00Z'),
      noCache: true,
    });

    expect(result.days.length).toBeGreaterThan(0);
    const day = result.days[0]!;
    expect(day.slots[0]!.startInBookerTz).toBe('03:00');
    // 11:00 NY = 15:00 UTC = 17:00 Rome. Last valid 60min start in 17:00 Rome
    // window is 17:00 Rome (= 11:00 NY).
    expect(day.slots[day.slots.length - 1]!.startInBookerTz).toBe('11:00');
  });
});
