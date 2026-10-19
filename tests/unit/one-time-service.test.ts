/**
 * One-time invitation service tests.
 *
 * Covers the lifecycle the admin sees:
 *   - create with custom availability → private schedule, primary calendar,
 *     re-copyable URL, and slots that follow the custom hours/overrides;
 *   - edit while pending (incl. switching between schedule and custom hours);
 *   - once booked: listed as booked, no URL, no edits, no delete;
 *   - gone from the list after the meeting is cancelled or over;
 *   - delete while pending removes the event type, invite, and private schedule.
 *
 * Google Calendar I/O is mocked at the wrapper layer like the other booking tests.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';

import * as gcal from '@/lib/google/calendar';
import { createBooking } from '@/lib/booking/create';
import { cancelBooking } from '@/lib/booking/cancel';
import { resolveInviteByRawToken } from '@/lib/booking/invite';
import { listSchedules } from '@/lib/availability/schedule';
import { computeSlots } from '@/lib/scheduling/compute';
import { pruneOldBookingInvites } from '@/lib/jobs/prune-invites';
import {
  createOneTimeLink,
  deleteOneTimeLink,
  getOneTimeLink,
  listOneTimeLinks,
  updateOneTimeLink,
} from '@/lib/one-time/service';
import { oneTimeLinkInputSchema, type OneTimeLinkInput } from '@/lib/one-time/validator';

const cleanups: Array<() => void> = [];

beforeEach(async () => {
  const { db } = await import('@/lib/db');
  await db.bookingHistory.deleteMany({});
  await db.bookingInvite.deleteMany({});
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

async function seed() {
  const { db } = await import('@/lib/db');
  const user = await db.user.create({
    data: {
      username: `ot-${randomBytes(4).toString('hex')}`,
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
  await db.calendar.create({
    data: {
      connectedAccountId: account.id,
      googleCalendarId: `side-${randomBytes(4).toString('hex')}@group.calendar.google.com`,
      name: 'Side',
      isPrimary: false,
    },
  });
  const primary = await db.calendar.create({
    data: {
      connectedAccountId: account.id,
      googleCalendarId: account.googleUserEmail,
      name: 'Primary',
      isPrimary: true,
      isBusySource: true,
      timezone: 'UTC',
    },
  });
  // Default schedule: weekdays 09–17.
  const defaultSchedule = await db.schedule.create({
    data: {
      userId: user.id,
      name: 'Default',
      isDefault: true,
      timezone: 'UTC',
      rules: {
        create: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })),
      },
    },
  });
  return { user, account, primary, defaultSchedule };
}

function input(accountId: string, overrides: Record<string, unknown> = {}): OneTimeLinkInput {
  return oneTimeLinkInputSchema.parse({
    title: 'Intro with Sarah',
    durationMinutes: 30,
    destinationAccountId: accountId,
    minNoticeMin: 0,
    ...overrides,
  });
}

/** Next Saturday (UTC) at least two days out. */
function nextSaturday(): DateTime {
  let d = DateTime.utc().plus({ days: 2 }).startOf('day');
  while (d.weekday !== 6) d = d.plus({ days: 1 });
  return d;
}

const saturdayOnly = (date?: string) => ({
  kind: 'custom' as const,
  timezone: 'UTC',
  rules: [{ weekday: 6, startMinute: 600, endMinute: 720 }], // Sat 10:00–12:00
  overrides: date ? [{ date, isBlocked: true }] : [],
});

function tokenFromUrl(url: string): string {
  return url.slice(url.lastIndexOf('/i/') + 3);
}

function mockGoogle() {
  const insert = spyOn(gcal, 'insertEvent').mockImplementation(
    async () =>
      ({ id: `g-${randomBytes(3).toString('hex')}`, hangoutLink: 'https://meet.google.com/x' }) as never,
  );
  const del = spyOn(gcal, 'deleteEvent').mockResolvedValue(undefined);
  cleanups.push(() => insert.mockRestore(), () => del.mockRestore());
}

async function bookVia(url: string, start: DateTime) {
  return createBooking({
    inviteToken: tokenFromUrl(url),
    startAtIso: start.toISO()!,
    bookerName: 'Sarah',
    bookerEmail: 'sarah@example.com',
    bookerTimezone: 'UTC',
  });
}

describe('createOneTimeLink', () => {
  it('stores custom hours in a private schedule and books onto the primary calendar', async () => {
    const { db } = await import('@/lib/db');
    const { user, account, primary } = await seed();
    const blocked = nextSaturday().plus({ weeks: 1 }).toISODate()!;

    const created = await createOneTimeLink(
      user.id,
      input(account.id, { availability: saturdayOnly(blocked) }),
    );

    const et = await db.eventType.findUniqueOrThrow({
      where: { id: created.eventTypeId },
      include: { schedule: { include: { rules: true, overrides: true } } },
    });
    expect(et.isOneTime).toBe(true);
    expect(et.inviteOnly).toBe(true);
    expect(et.destinationCalendarId).toBe(primary.id);
    expect(et.schedule?.isOneTime).toBe(true);
    expect(et.schedule?.rules).toHaveLength(1);
    expect(et.schedule?.overrides).toHaveLength(1);

    // Private schedules never show up as a pickable schedule.
    const schedules = await listSchedules(user.id);
    expect(schedules.map((s) => s.id)).not.toContain(et.scheduleId);

    // The URL resolves to the invite.
    const resolved = await resolveInviteByRawToken(tokenFromUrl(created.url));
    expect(resolved.status).toBe('ok');
    expect(resolved.eventType?.id).toBe(et.id);
  });

  it('only offers slots inside the custom hours, minus blocked dates', async () => {
    const { db } = await import('@/lib/db');
    const { user, account } = await seed();
    const firstSat = nextSaturday();
    const blockedSat = firstSat.plus({ weeks: 1 });

    const created = await createOneTimeLink(
      user.id,
      input(account.id, { availability: saturdayOnly(blockedSat.toISODate()!) }),
    );
    const et = await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } });

    const result = await computeSlots({
      eventType: et,
      user,
      from: firstSat.minus({ days: 1 }).toJSDate(),
      to: firstSat.plus({ weeks: 2 }).toJSDate(),
      bookerTz: 'UTC',
      noCache: true,
    });

    const dates = result.days.map((d) => d.date);
    expect(dates).toContain(firstSat.toISODate()!);
    expect(dates).not.toContain(blockedSat.toISODate()!);
    for (const day of result.days) {
      expect(DateTime.fromISO(day.date, { zone: 'utc' }).weekday).toBe(6);
      for (const s of day.slots) {
        expect(s.startInBookerTz >= '10:00' && s.startInBookerTz <= '11:30').toBe(true);
      }
    }
  });

  it('rejects an account without a primary calendar', async () => {
    const { db } = await import('@/lib/db');
    const { user } = await seed();
    const orphan = await db.connectedAccount.create({
      data: {
        provider: 'google',
        googleUserEmail: 'no-primary@example.com',
        accessTokenEnc: 'x',
        refreshTokenEnc: 'x',
        scopes: 'calendar',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await expect(createOneTimeLink(user.id, input(orphan.id))).rejects.toMatchObject({
      name: 'OneTimeLinkError',
      status: 400,
    });
  });
});

describe('pending invitations', () => {
  it('lists the re-copyable URL and lets everything be edited', async () => {
    const { db } = await import('@/lib/db');
    const { user, account, defaultSchedule } = await seed();
    const created = await createOneTimeLink(user.id, input(account.id));

    const [listed] = await listOneTimeLinks(user.id);
    expect(listed?.status).toBe('pending');
    expect(listed?.url).toBe(created.url);
    expect(listed?.availabilityLabel).toBe('Default schedule');

    // Switch to custom hours.
    await updateOneTimeLink(
      user.id,
      created.eventTypeId,
      input(account.id, { title: 'Renamed', note: 'Sarah @ Acme', availability: saturdayOnly() }),
    );
    let detail = await getOneTimeLink(user.id, created.eventTypeId);
    expect(detail.values.title).toBe('Renamed');
    expect(detail.values.note).toBe('Sarah @ Acme');
    expect(detail.values.availability).toEqual(saturdayOnly());
    expect(detail.url).toBe(created.url); // same link after edits
    const privateId = (await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } }))
      .scheduleId!;

    // Edit custom hours in place — same private schedule row.
    await updateOneTimeLink(
      user.id,
      created.eventTypeId,
      input(account.id, {
        availability: { ...saturdayOnly(), rules: [{ weekday: 0, startMinute: 60, endMinute: 120 }] },
      }),
    );
    const et = await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } });
    expect(et.scheduleId).toBe(privateId);

    // Back to the shared default schedule — the private one is removed.
    await updateOneTimeLink(user.id, created.eventTypeId, input(account.id));
    detail = await getOneTimeLink(user.id, created.eventTypeId);
    expect(detail.values.availability).toEqual({ kind: 'schedule', scheduleId: null });
    expect(
      (await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } })).scheduleId,
    ).toBe(defaultSchedule.id);
    expect(await db.schedule.findUnique({ where: { id: privateId } })).toBeNull();
  });

  it('deleting removes the event type, the invite and the private schedule', async () => {
    const { db } = await import('@/lib/db');
    const { user, account } = await seed();
    const created = await createOneTimeLink(
      user.id,
      input(account.id, { availability: saturdayOnly() }),
    );
    const scheduleId = (
      await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } })
    ).scheduleId!;

    await deleteOneTimeLink(user.id, created.eventTypeId);

    expect(await db.eventType.findUnique({ where: { id: created.eventTypeId } })).toBeNull();
    expect(await db.schedule.findUnique({ where: { id: scheduleId } })).toBeNull();
    expect((await resolveInviteByRawToken(tokenFromUrl(created.url))).status).toBe('not_found');
    expect(await listOneTimeLinks(user.id)).toEqual([]);
  });

  it("refuses to use another user's invitation", async () => {
    const { db } = await import('@/lib/db');
    const { user, account } = await seed();
    const created = await createOneTimeLink(user.id, input(account.id));
    const other = await db.user.create({
      data: { username: 'other', passwordHash: 'x', email: 'o@example.com', displayName: 'O' },
    });
    await expect(getOneTimeLink(other.id, created.eventTypeId)).rejects.toMatchObject({ status: 404 });
    await expect(deleteOneTimeLink(other.id, created.eventTypeId)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('booked invitations', () => {
  it('lock edits and deletion until the meeting is cancelled or over', async () => {
    const { user, account } = await seed();
    mockGoogle();
    const created = await createOneTimeLink(
      user.id,
      input(account.id, { availability: saturdayOnly() }),
    );
    const start = nextSaturday().set({ hour: 10 });
    const { booking } = await bookVia(created.url, start);

    const [listed] = await listOneTimeLinks(user.id);
    expect(listed?.status).toBe('booked');
    expect(listed?.url).toBeNull();
    expect(listed?.booking?.id).toBe(booking.id);

    await expect(
      updateOneTimeLink(user.id, created.eventTypeId, input(account.id, { title: 'Nope' })),
    ).rejects.toMatchObject({ status: 409 });
    await expect(deleteOneTimeLink(user.id, created.eventTypeId)).rejects.toMatchObject({
      status: 409,
    });

    // Disappears once the meeting is over…
    const afterMeeting = start.plus({ hours: 1 }).toJSDate();
    expect(await listOneTimeLinks(user.id, afterMeeting)).toEqual([]);

    // …or as soon as the owner cancels it.
    await cancelBooking({ bookingId: booking.id, actor: 'owner' });
    expect(await listOneTimeLinks(user.id)).toEqual([]);
  });

  it('drops expired pending invitations from the list', async () => {
    const { user, account } = await seed();
    await createOneTimeLink(
      user.id,
      input(account.id, { expiresAt: DateTime.utc().plus({ days: 1 }).toISO() }),
    );
    expect(await listOneTimeLinks(user.id)).toHaveLength(1);
    expect(await listOneTimeLinks(user.id, DateTime.utc().plus({ days: 2 }).toJSDate())).toEqual(
      [],
    );
  });
});

describe('pruneOldBookingInvites', () => {
  it('sweeps private schedules left behind by deleted invitations', async () => {
    const { db } = await import('@/lib/db');
    const { user, account } = await seed();
    const created = await createOneTimeLink(
      user.id,
      input(account.id, { availability: saturdayOnly() }),
    );
    const scheduleId = (
      await db.eventType.findUniqueOrThrow({ where: { id: created.eventTypeId } })
    ).scheduleId!;
    // Simulate the stage-2 sweep deleting the event type directly.
    await db.eventType.delete({ where: { id: created.eventTypeId } });

    const result = await pruneOldBookingInvites();

    expect(result.deletedSchedules).toBe(1);
    expect(await db.schedule.findUnique({ where: { id: scheduleId } })).toBeNull();
  });
});
