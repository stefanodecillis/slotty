import { describe, it, expect, beforeEach } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { _resetForTests } from '@/lib/ratelimit';
import { invalidate as invalidateCache } from '@/lib/scheduling/cache';

interface SeededFixtures {
  slug: string;
  userId: string;
}

async function seedEventType(): Promise<SeededFixtures> {
  const { db } = await import('@/lib/db');

  const user = await db.user.create({
    data: {
      username: `api-${randomBytes(4).toString('hex')}`,
      passwordHash: 'placeholder',
      email: 'api@example.com',
      displayName: 'API Test',
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

  await db.schedule.create({
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

  const slug = `et-${randomBytes(4).toString('hex')}`;
  await db.eventType.create({
    data: {
      userId: user.id,
      title: 'Test',
      slug,
      color: '#000000',
      hidden: false,
      durationMinutes: 30,
      destinationAccountId: account.id,
      destinationCalendarId: calendar.id,
      locationKind: 'google_meet',
      slotIntervalMin: 30,
      bookingWindowDays: 60,
      minNoticeMin: 0,
      sendReminders: true,
    },
  });

  return { slug, userId: user.id };
}

async function callRoute(req: Request, params: { slug: string }) {
  // Dynamic-import the route every time to ensure module state hasn't been
  // wedged by a previous call.
  const mod = await import('@/app/api/public/event-types/[slug]/slots/route');
  return mod.GET(req as never, { params });
}

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
  _resetForTests();
});

describe('GET /api/public/event-types/[slug]/slots', () => {
  it('returns 200 + SlotResult-shaped JSON for valid input', async () => {
    const { slug } = await seedEventType();

    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-05-04T00:00:00Z');
    url.searchParams.set('to', '2026-05-09T00:00:00Z');
    url.searchParams.set('tz', 'UTC');

    const res = await callRoute(new Request(url.toString()), { slug });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: unknown[]; bookerTz: string; eventTypeId: string };
    expect(body.bookerTz).toBe('UTC');
    expect(Array.isArray(body.days)).toBe(true);
  });

  it('rejects an invalid IANA timezone with 400', async () => {
    const { slug } = await seedEventType();
    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-05-04T00:00:00Z');
    url.searchParams.set('to', '2026-05-09T00:00:00Z');
    url.searchParams.set('tz', 'Not/A_Real_TZ');

    const res = await callRoute(new Request(url.toString()), { slug });
    expect(res.status).toBe(400);
  });

  it('rejects ranges greater than 90 days with 400', async () => {
    const { slug } = await seedEventType();
    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-01-01T00:00:00Z');
    url.searchParams.set('to', '2026-06-01T00:00:00Z');
    url.searchParams.set('tz', 'UTC');

    const res = await callRoute(new Request(url.toString()), { slug });
    expect(res.status).toBe(400);
  });

  it('rejects inverted ranges with 400', async () => {
    const { slug } = await seedEventType();
    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-05-09T00:00:00Z');
    url.searchParams.set('to', '2026-05-04T00:00:00Z');
    url.searchParams.set('tz', 'UTC');

    const res = await callRoute(new Request(url.toString()), { slug });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown slug', async () => {
    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-05-04T00:00:00Z');
    url.searchParams.set('to', '2026-05-09T00:00:00Z');
    url.searchParams.set('tz', 'UTC');

    const res = await callRoute(new Request(url.toString()), { slug: 'nonexistent' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for an archived slug', async () => {
    const { slug } = await seedEventType();
    const { db } = await import('@/lib/db');
    await db.eventType.update({ where: { slug }, data: { archived: true } });

    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-05-04T00:00:00Z');
    url.searchParams.set('to', '2026-05-09T00:00:00Z');
    url.searchParams.set('tz', 'UTC');

    const res = await callRoute(new Request(url.toString()), { slug });
    expect(res.status).toBe(404);
  });

  it('rate-limits the 61st request from the same IP within a minute', async () => {
    const { slug } = await seedEventType();

    const url = new URL('http://localhost/api/public/event-types/x/slots');
    url.searchParams.set('from', '2026-05-04T00:00:00Z');
    url.searchParams.set('to', '2026-05-09T00:00:00Z');
    url.searchParams.set('tz', 'UTC');

    // The IP resolver returns "unknown" by default since SLOTTY_TRUST_PROXY
    // is unset; that single bucket is what gets rate-limited.
    let lastRes: Response | null = null;
    for (let i = 0; i < 60; i += 1) {
      lastRes = await callRoute(new Request(url.toString()), { slug });
      expect(lastRes.status).toBe(200);
    }
    const blocked = await callRoute(new Request(url.toString()), { slug });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
  });
});
