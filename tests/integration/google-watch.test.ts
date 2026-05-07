/**
 * Push notification (events.watch) lifecycle + webhook receiver tests.
 *
 * We mock `watchCalendar` / `stopWatch` (the wrappers around googleapis)
 * with `spyOn` rather than HTTP-level mocking — Bun's fetch routes around
 * the Node http hooks `nock` patches. The webhook route still gets its
 * full HMAC token verification path exercised end-to-end.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.SLOTTY_PUBLIC_URL ??= 'http://localhost:3000';
  process.env.SLOTTY_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.SLOTTY_SESSION_SECRET ??= randomBytes(64).toString('base64');
  process.env.SLOTTY_GOOGLE_CLIENT_ID ??= 'test-client-id';
  process.env.SLOTTY_GOOGLE_CLIENT_SECRET ??= 'test-client-secret';
});

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.busyEvent.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.job.deleteMany({});
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function seed() {
  const { db } = await import('@/lib/db');
  const { encrypt } = await import('@/lib/crypto');
  const account = await db.connectedAccount.create({
    data: {
      provider: 'google',
      googleUserEmail: 'watcher@example.com',
      accessTokenEnc: encrypt('access'),
      refreshTokenEnc: encrypt('refresh'),
      scopes: 'calendar.readonly',
      expiresAt: new Date(Date.now() + 50 * 60 * 1000),
      status: 'active',
    },
  });
  const calendar = await db.calendar.create({
    data: {
      connectedAccountId: account.id,
      googleCalendarId: 'watcher@example.com',
      name: 'Watch test',
      isPrimary: true,
      isBusySource: true,
    },
  });
  return { account, calendar };
}

describe('setupWatchChannel', () => {
  it('registers a channel and persists id + resourceId + expiry', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { calendar } = await seed();

    const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
    const sp = spyOn(calendarMod, 'watchCalendar');
    sp.mockImplementation(async (_acc, _cal, channelId) => ({
      channelId,
      resourceId: 'resource-id-1',
      expiration,
    }));
    cleanups.push(() => sp.mockRestore());

    const { setupWatchChannel } = await import('@/lib/sync/watch');
    await setupWatchChannel(calendar.id);
    expect(sp.mock.calls.length).toBe(1);

    const cal = await db.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
    expect(cal.watchChannelId).not.toBeNull();
    expect(cal.watchResourceId).toBe('resource-id-1');
    expect(cal.watchExpiresAt).not.toBeNull();
  });

  it('stopWatchForCalendar tears down channel and clears DB fields', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { calendar } = await seed();

    await db.calendar.update({
      where: { id: calendar.id },
      data: {
        watchChannelId: 'chan-stop',
        watchResourceId: 'res-stop',
        watchExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    let stopArgs: { channelId?: string; resourceId?: string } = {};
    const sp = spyOn(calendarMod, 'stopWatch');
    sp.mockImplementation(async (_a, channelId, resourceId) => {
      stopArgs = { channelId, resourceId };
    });
    cleanups.push(() => sp.mockRestore());

    const { stopWatchForCalendar } = await import('@/lib/sync/watch');
    await stopWatchForCalendar(calendar.id);

    expect(stopArgs.channelId).toBe('chan-stop');
    expect(stopArgs.resourceId).toBe('res-stop');

    const cal = await db.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
    expect(cal.watchChannelId).toBeNull();
    expect(cal.watchResourceId).toBeNull();
    expect(cal.watchExpiresAt).toBeNull();
  });
});

describe('webhook /api/webhooks/google', () => {
  it('enqueues incremental_sync on valid push notification', async () => {
    const { POST } = await import('@/app/api/webhooks/google/route');
    const { db } = await import('@/lib/db');
    const { watchTokenFor } = await import('@/lib/sync/watch');
    const { calendar } = await seed();

    await db.calendar.update({
      where: { id: calendar.id },
      data: {
        watchChannelId: 'chan-test',
        watchResourceId: 'res-test',
        watchExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const token = watchTokenFor(calendar.id);
    const req = new Request('http://localhost:3000/api/webhooks/google', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'chan-test',
        'x-goog-resource-id': 'res-test',
        'x-goog-resource-state': 'exists',
        'x-goog-channel-token': token,
      },
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);

    // Fire-and-forget enqueue — wait briefly for write.
    await new Promise((r) => setTimeout(r, 50));

    const jobs = await db.job.findMany({ where: { kind: 'incremental_sync' } });
    expect(jobs.length).toBe(1);
    const payload = JSON.parse(jobs[0]!.payloadJson) as { calendarId?: string };
    expect(payload.calendarId).toBe(calendar.id);
  });

  it('returns 401 on invalid X-Goog-Channel-Token', async () => {
    const { POST } = await import('@/app/api/webhooks/google/route');
    const { db } = await import('@/lib/db');
    const { calendar } = await seed();
    await db.calendar.update({
      where: { id: calendar.id },
      data: {
        watchChannelId: 'chan-bad',
        watchResourceId: 'res-bad',
        watchExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const req = new Request('http://localhost:3000/api/webhooks/google', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'chan-bad',
        'x-goog-resource-id': 'res-bad',
        'x-goog-resource-state': 'exists',
        'x-goog-channel-token': 'wrong-token',
      },
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);

    const jobs = await db.job.findMany({ where: { kind: 'incremental_sync' } });
    expect(jobs.length).toBe(0);
  });

  it('handshakes (resource-state=sync) without enqueueing work', async () => {
    const { POST } = await import('@/app/api/webhooks/google/route');
    const { db } = await import('@/lib/db');
    const { watchTokenFor } = await import('@/lib/sync/watch');
    const { calendar } = await seed();
    await db.calendar.update({
      where: { id: calendar.id },
      data: {
        watchChannelId: 'chan-shake',
        watchResourceId: 'res-shake',
        watchExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const req = new Request('http://localhost:3000/api/webhooks/google', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'chan-shake',
        'x-goog-resource-id': 'res-shake',
        'x-goog-resource-state': 'sync',
        'x-goog-channel-token': watchTokenFor(calendar.id),
      },
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);

    const jobs = await db.job.findMany({ where: { kind: 'incremental_sync' } });
    expect(jobs.length).toBe(0);
  });

  it('200s and ignores unknown channels', async () => {
    const { POST } = await import('@/app/api/webhooks/google/route');
    const req = new Request('http://localhost:3000/api/webhooks/google', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'unknown-chan',
        'x-goog-resource-id': 'whatever',
        'x-goog-resource-state': 'exists',
        'x-goog-channel-token': 'whatever',
      },
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
  });
});
