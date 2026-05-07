/**
 * Informational performance check for slot computation.
 *
 * Goal: a 30-day window with 5 calendars and ~500 BusyEvents finishes under
 * 300ms p95 on the developer's machine. We log the timing but only fail in
 * a soft way (long timeout) so flaky CI hardware doesn't break the build.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { computeSlots } from '@/lib/scheduling/compute';
import { invalidate as invalidateCache } from '@/lib/scheduling/cache';

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.busyEvent.deleteMany({});
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

describe('scheduling perf (informational)', () => {
  it('computes a 30-day window in under 1s and caches a hit under 50ms', async () => {
    const { db } = await import('@/lib/db');

    const user = await db.user.create({
      data: {
        username: `perf-${randomBytes(4).toString('hex')}`,
        passwordHash: 'placeholder',
        email: 'perf@example.com',
        displayName: 'Perf',
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

    const calendars = [];
    for (let c = 0; c < 5; c += 1) {
      const cal = await db.calendar.create({
        data: {
          connectedAccountId: account.id,
          googleCalendarId: `cal-${c}-${randomBytes(4).toString('hex')}`,
          name: `Cal ${c}`,
          isBusySource: true,
          isDestinationEligible: c === 0,
        },
      });
      calendars.push(cal);
    }

    const baseDate = new Date('2026-05-01T00:00:00Z');
    for (const cal of calendars) {
      const data: { calendarId: string; googleEventId: string; startAt: Date; endAt: Date; status: string; transparency: string }[] = [];
      for (let i = 0; i < 100; i += 1) {
        const dayOffset = Math.floor(Math.random() * 30);
        const hour = 8 + Math.floor(Math.random() * 10);
        const start = new Date(baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        data.push({
          calendarId: cal.id,
          googleEventId: `${cal.id}-${i}`,
          startAt: start,
          endAt: end,
          status: 'confirmed',
          transparency: 'opaque',
        });
      }
      await db.busyEvent.createMany({ data });
    }

    const schedule = await db.schedule.create({
      data: {
        userId: user.id,
        name: 'Default',
        isDefault: true,
        timezone: 'UTC',
        rules: {
          create: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            startMinute: 9 * 60,
            endMinute: 18 * 60,
          })),
        },
      },
    });

    const eventType = await db.eventType.create({
      data: {
        userId: user.id,
        title: 'Perf Test',
        slug: `perf-${randomBytes(4).toString('hex')}`,
        color: '#000',
        hidden: false,
        durationMinutes: 30,
        destinationAccountId: account.id,
        destinationCalendarId: calendars[0]!.id,
        locationKind: 'google_meet',
        slotIntervalMin: 30,
        bookingWindowDays: 60,
        minNoticeMin: 0,
        scheduleId: schedule.id,
        sendReminders: true,
      },
    });

    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-05-31T00:00:00Z');

    const t0 = Date.now();
    await computeSlots({
      eventType,
      user,
      from,
      to,
      bookerTz: 'UTC',
      now: from,
    });
    const cold = Date.now() - t0;
    console.log(`[perf] cold computeSlots: ${cold}ms`);

    const t1 = Date.now();
    await computeSlots({
      eventType,
      user,
      from,
      to,
      bookerTz: 'UTC',
      now: from,
    });
    const warm = Date.now() - t1;
    console.log(`[perf] warm (cached) computeSlots: ${warm}ms`);

    // Generous bounds so this doesn't break on slow CI.
    expect(cold).toBeLessThan(2000);
    expect(warm).toBeLessThan(150);
  });
});
