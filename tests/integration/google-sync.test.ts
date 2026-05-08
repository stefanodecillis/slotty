/**
 * Sync engine state-machine tests.
 *
 * We mock `listEventsIncremental` (the wrapper around googleapis events.list)
 * with `spyOn` rather than HTTP-level mocking — Bun's fetch routes around
 * the Node http hooks `nock` patches. Driving the wrapper still exercises
 * the full `syncCalendarIncremental` state machine:
 *   1. First call (no syncToken) hydrates BusyEvent rows.
 *   2. Second call (with syncToken) processes deltas — cancellations remove,
 *      new events insert.
 *   3. fullResyncRequired triggers wipe + refetch.
 *   4. transparency=transparent events are excluded.
 *   5. All-day events stored with isAllDay=true and UTC midnight bounds.
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
  // Phase 7 added Booking → EventType → Calendar/ConnectedAccount FKs; clear
  // bookings before event types, and event types before calendars/accounts.
  await db.bookingHistory.deleteMany({});
  await db.booking.deleteMany({});
  await db.eventTypeQuestion.deleteMany({});
  await db.eventType.deleteMany({});
  await db.calendar.deleteMany({});
  await db.connectedAccount.deleteMany({});
  await db.user.deleteMany({});
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function seedAccountAndCalendar() {
  const { db } = await import('@/lib/db');
  const { encrypt } = await import('@/lib/crypto');
  const account = await db.connectedAccount.create({
    data: {
      provider: 'google',
      googleUserEmail: 'sync@example.com',
      accessTokenEnc: encrypt('access-token-1'),
      refreshTokenEnc: encrypt('refresh-token-1'),
      scopes: 'calendar.readonly',
      // Far in future so the proactive refresh path stays quiet.
      expiresAt: new Date(Date.now() + 50 * 60 * 1000),
      status: 'active',
    },
  });
  const calendar = await db.calendar.create({
    data: {
      connectedAccountId: account.id,
      googleCalendarId: 'sync@example.com',
      name: 'Test',
      isPrimary: true,
      isBusySource: true,
    },
  });
  return { account, calendar };
}

describe('syncCalendarIncremental', () => {
  it('full → incremental → fullResyncRequired forces wipe + refetch', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { calendar } = await seedAccountAndCalendar();

    const calls: Array<{ syncToken: string | undefined }> = [];
    const responses: Array<unknown> = [
      // 1) full snapshot — 3 events, one transparent.
      {
        events: [
          {
            id: 'ev-a',
            status: 'confirmed',
            start: { dateTime: '2026-06-01T10:00:00Z' },
            end: { dateTime: '2026-06-01T11:00:00Z' },
          },
          {
            id: 'ev-b',
            status: 'tentative',
            start: { dateTime: '2026-06-02T14:00:00Z' },
            end: { dateTime: '2026-06-02T15:00:00Z' },
          },
          {
            id: 'ev-c-free',
            status: 'confirmed',
            transparency: 'transparent',
            start: { dateTime: '2026-06-03T09:00:00Z' },
            end: { dateTime: '2026-06-03T10:00:00Z' },
          },
        ],
        nextSyncToken: 'token-1',
        fullResyncRequired: false,
      },
      // 2) incremental — cancel ev-a, add ev-d.
      {
        events: [
          { id: 'ev-a', status: 'cancelled' },
          {
            id: 'ev-d',
            status: 'confirmed',
            start: { dateTime: '2026-06-05T08:00:00Z' },
            end: { dateTime: '2026-06-05T09:00:00Z' },
          },
        ],
        nextSyncToken: 'token-2',
        fullResyncRequired: false,
      },
      // 3) syncToken expired → fullResyncRequired.
      {
        events: [],
        nextSyncToken: null,
        fullResyncRequired: true,
      },
      // 4) post-fullResync re-fetch — fresh full snapshot.
      {
        events: [
          {
            id: 'ev-fresh',
            status: 'confirmed',
            start: { dateTime: '2026-07-01T10:00:00Z' },
            end: { dateTime: '2026-07-01T11:00:00Z' },
          },
        ],
        nextSyncToken: 'token-3',
        fullResyncRequired: false,
      },
    ];

    const sp = spyOn(calendarMod, 'listEventsIncremental');
    sp.mockImplementation(async (_a, _c, syncToken) => {
      calls.push({ syncToken });
      const next = responses.shift();
      if (!next) throw new Error('no response queued');
      return next as Awaited<ReturnType<typeof calendarMod.listEventsIncremental>>;
    });
    cleanups.push(() => sp.mockRestore());

    const { syncCalendarIncremental } = await import('@/lib/sync/incremental');

    // ── Pass 1: initial full sync.
    await syncCalendarIncremental(calendar.id);
    let events = await db.busyEvent.findMany({ where: { calendarId: calendar.id } });
    expect(events.length).toBe(2);
    expect(events.find((e) => e.googleEventId === 'ev-c-free')).toBeUndefined();
    let cal = await db.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
    expect(cal.syncToken).toBe('token-1');

    // ── Pass 2: incremental.
    await syncCalendarIncremental(calendar.id);
    events = await db.busyEvent.findMany({ where: { calendarId: calendar.id } });
    expect(events.map((e) => e.googleEventId).sort()).toEqual(['ev-b', 'ev-d']);
    cal = await db.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
    expect(cal.syncToken).toBe('token-2');

    // ── Pass 3: 410-equivalent. The handler will recurse — pass 4 is the
    // refetch.
    await syncCalendarIncremental(calendar.id);
    events = await db.busyEvent.findMany({ where: { calendarId: calendar.id } });
    expect(events.length).toBe(1);
    expect(events[0]!.googleEventId).toBe('ev-fresh');
    cal = await db.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
    expect(cal.syncToken).toBe('token-3');

    // Sanity: full resync was triggered (call 3 had syncToken=token-2, call
    // 4 had syncToken undefined because the table was wiped).
    expect(calls[0]?.syncToken).toBeUndefined();
    expect(calls[1]?.syncToken).toBe('token-1');
    expect(calls[2]?.syncToken).toBe('token-2');
    expect(calls[3]?.syncToken).toBeUndefined();
  });

  it('stores all-day events with isAllDay=true and UTC midnight bounds', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { calendar } = await seedAccountAndCalendar();

    const sp = spyOn(calendarMod, 'listEventsIncremental');
    sp.mockResolvedValue({
      events: [
        {
          id: 'ev-allday',
          status: 'confirmed',
          start: { date: '2026-08-01' },
          end: { date: '2026-08-02' },
        },
      ],
      nextSyncToken: 'tk-allday',
      fullResyncRequired: false,
    });
    cleanups.push(() => sp.mockRestore());

    const { syncCalendarIncremental } = await import('@/lib/sync/incremental');
    await syncCalendarIncremental(calendar.id);

    const ev = await db.busyEvent.findFirstOrThrow({
      where: { calendarId: calendar.id, googleEventId: 'ev-allday' },
    });
    expect(ev.isAllDay).toBe(true);
    expect(ev.startAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(ev.endAt.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('removes a previously-busy event when it becomes transparent', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { calendar } = await seedAccountAndCalendar();

    const responses: Array<unknown> = [
      {
        events: [
          {
            id: 'ev-flip',
            status: 'confirmed',
            start: { dateTime: '2026-09-01T10:00:00Z' },
            end: { dateTime: '2026-09-01T11:00:00Z' },
          },
        ],
        nextSyncToken: 'flip-1',
        fullResyncRequired: false,
      },
      {
        events: [
          {
            id: 'ev-flip',
            status: 'confirmed',
            transparency: 'transparent',
            start: { dateTime: '2026-09-01T10:00:00Z' },
            end: { dateTime: '2026-09-01T11:00:00Z' },
          },
        ],
        nextSyncToken: 'flip-2',
        fullResyncRequired: false,
      },
    ];

    const sp = spyOn(calendarMod, 'listEventsIncremental');
    sp.mockImplementation(
      async () => responses.shift() as Awaited<ReturnType<typeof calendarMod.listEventsIncremental>>,
    );
    cleanups.push(() => sp.mockRestore());

    const { syncCalendarIncremental } = await import('@/lib/sync/incremental');
    await syncCalendarIncremental(calendar.id);
    let count = await db.busyEvent.count({ where: { calendarId: calendar.id } });
    expect(count).toBe(1);

    await syncCalendarIncremental(calendar.id);
    count = await db.busyEvent.count({ where: { calendarId: calendar.id } });
    expect(count).toBe(0);
  });

  it('cancels matching booking when its Google event is deleted upstream', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { account, calendar } = await seedAccountAndCalendar();

    const user = await db.user.create({
      data: {
        username: `sync-${randomBytes(4).toString('hex')}`,
        passwordHash: 'placeholder',
        email: 'owner@example.com',
        displayName: 'Owner',
        timezone: 'UTC',
      },
    });
    const eventType = await db.eventType.create({
      data: {
        userId: user.id,
        title: 'Sync Cancel Test',
        slug: `sct-${randomBytes(4).toString('hex')}`,
        durationMinutes: 30,
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        locationKind: 'google_meet',
      },
    });
    const booking = await db.booking.create({
      data: {
        eventTypeId: eventType.id,
        googleAccountId: account.id,
        googleCalendarId: calendar.id,
        googleEventId: 'gev-deleted',
        startAt: new Date('2026-06-10T10:00:00Z'),
        endAt: new Date('2026-06-10T10:30:00Z'),
        status: 'confirmed',
        bookerName: 'Booker',
        bookerEmail: 'booker@example.com',
        bookerTimezone: 'UTC',
        cancelTokenHash: 'x',
        rescheduleTokenHash: 'x',
      },
    });
    // Plus an unrelated booking to confirm scoping doesn't over-match.
    const otherBooking = await db.booking.create({
      data: {
        eventTypeId: eventType.id,
        googleAccountId: account.id,
        googleCalendarId: calendar.id,
        googleEventId: 'gev-other',
        startAt: new Date('2026-06-11T10:00:00Z'),
        endAt: new Date('2026-06-11T10:30:00Z'),
        status: 'confirmed',
        bookerName: 'Other',
        bookerEmail: 'other@example.com',
        bookerTimezone: 'UTC',
        cancelTokenHash: 'x',
        rescheduleTokenHash: 'x',
      },
    });

    // Pre-seed the BusyEvent rows that a prior sync would have hydrated.
    await db.busyEvent.createMany({
      data: [
        {
          calendarId: calendar.id,
          googleEventId: 'gev-deleted',
          startAt: booking.startAt,
          endAt: booking.endAt,
          status: 'confirmed',
        },
        {
          calendarId: calendar.id,
          googleEventId: 'gev-other',
          startAt: otherBooking.startAt,
          endAt: otherBooking.endAt,
          status: 'confirmed',
        },
      ],
    });
    await db.calendar.update({ where: { id: calendar.id }, data: { syncToken: 'token-pre' } });

    const sp = spyOn(calendarMod, 'listEventsIncremental');
    sp.mockResolvedValueOnce({
      events: [{ id: 'gev-deleted', status: 'cancelled' }],
      nextSyncToken: 'token-post',
      fullResyncRequired: false,
    });
    cleanups.push(() => sp.mockRestore());

    const { syncCalendarIncremental } = await import('@/lib/sync/incremental');
    await syncCalendarIncremental(calendar.id);

    const cancelled = await db.booking.findUnique({ where: { id: booking.id } });
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelReason).toBe('Deleted in Google Calendar');
    expect(cancelled?.cancelledAt).not.toBeNull();

    const untouched = await db.booking.findUnique({ where: { id: otherBooking.id } });
    expect(untouched?.status).toBe('confirmed');

    const history = await db.bookingHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(1);
    expect(history[0]!.action).toBe('cancelled');
    expect(history[0]!.actor).toBe('system');

    // BusyEvent for the deleted event is also gone (slot reopens).
    const busy = await db.busyEvent.findFirst({
      where: { calendarId: calendar.id, googleEventId: 'gev-deleted' },
    });
    expect(busy).toBeNull();
  });

  it('is idempotent when a booking is already cancelled (echoed webhook)', async () => {
    const calendarMod = await import('@/lib/google/calendar');
    const { db } = await import('@/lib/db');
    const { account, calendar } = await seedAccountAndCalendar();

    const user = await db.user.create({
      data: {
        username: `sync-${randomBytes(4).toString('hex')}`,
        passwordHash: 'placeholder',
        email: 'owner2@example.com',
        displayName: 'Owner',
        timezone: 'UTC',
      },
    });
    const eventType = await db.eventType.create({
      data: {
        userId: user.id,
        title: 'Sync Idempotent',
        slug: `sct-${randomBytes(4).toString('hex')}`,
        durationMinutes: 30,
        destinationAccountId: account.id,
        destinationCalendarId: calendar.id,
        locationKind: 'google_meet',
      },
    });
    const booking = await db.booking.create({
      data: {
        eventTypeId: eventType.id,
        googleAccountId: account.id,
        googleCalendarId: calendar.id,
        googleEventId: 'gev-already-cancelled',
        startAt: new Date('2026-06-12T10:00:00Z'),
        endAt: new Date('2026-06-12T10:30:00Z'),
        status: 'cancelled',
        cancelledAt: new Date('2026-06-09T09:00:00Z'),
        cancelReason: 'Booker cancelled',
        bookerName: 'Booker',
        bookerEmail: 'booker@example.com',
        bookerTimezone: 'UTC',
        cancelTokenHash: 'x',
        rescheduleTokenHash: 'x',
      },
    });

    const sp = spyOn(calendarMod, 'listEventsIncremental');
    sp.mockResolvedValueOnce({
      events: [{ id: 'gev-already-cancelled', status: 'cancelled' }],
      nextSyncToken: 'token-post',
      fullResyncRequired: false,
    });
    cleanups.push(() => sp.mockRestore());

    const { syncCalendarIncremental } = await import('@/lib/sync/incremental');
    await syncCalendarIncremental(calendar.id);

    const after = await db.booking.findUnique({ where: { id: booking.id } });
    // Reason untouched — idempotent guard prevented overwriting.
    expect(after?.cancelReason).toBe('Booker cancelled');
    const history = await db.bookingHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(0);
  });
});
