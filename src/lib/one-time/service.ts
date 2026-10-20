/**
 * One-time invitations.
 *
 * An invitation is a hidden + invite-only EventType (`isOneTime`) paired with
 * a single BookingInvite. Lifecycle as seen by the admin:
 *
 *   pending  — the link is live. Everything is editable, the URL can be
 *              copied again (the raw token is stored encrypted), and the
 *              invitation can be deleted outright.
 *   booked   — someone booked through the link and the meeting hasn't ended.
 *              Nothing is editable any more; the only action is cancelling
 *              the meeting (regular owner-cancel), which ends the invitation.
 *   (gone)   — the meeting is over, was cancelled, or the link expired /
 *              was revoked. Hidden from the admin list and eventually swept
 *              by the `prune_booking_invites` job.
 *
 * Availability is either a reference to one of the owner's schedules, or a
 * private `Schedule` row (`isOneTime`) holding custom weekly hours and date
 * overrides that belong to this invitation alone.
 *
 * With `groupPoll.enabled` the invitation runs as a group availability poll
 * (`GroupPoll`, see `src/lib/group-poll/service.ts`): many people answer,
 * and the owner books the common slot. It stays "pending" while collecting.
 */
import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { decrypt, encrypt, generateToken } from '@/lib/crypto';
import { DefaultCalendarError, resolveDefaultCalendarId } from '@/lib/google/default-calendar';
import { invalidate as invalidateSlotCache } from '@/lib/scheduling/cache';
import { getPublicUrl } from '@/lib/site-url/store';
import { logger } from '@/lib/logger';
import { MAX_POLL_PARTICIPANTS, type GroupPollSettings } from '@/lib/group-poll/validator';
import { answeredEmails, checkPollReady } from '@/lib/group-poll/service';
import type { OneTimeAvailabilityInput, OneTimeLinkInput } from './validator';

export class OneTimeLinkError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'OneTimeLinkError';
  }
}

// Bookings that still occupy the invitation. `rescheduled` is a transient
// state the reschedule flow settles back to `confirmed`.
const LIVE_BOOKING_STATUSES = ['confirmed', 'rescheduled'];

// ─────────────────────────────────────────────────────────────
// Shapes returned to the admin UI
// ─────────────────────────────────────────────────────────────

export type OneTimeLinkStatus = 'pending' | 'booked';

export interface OneTimeLinkBooking {
  id: string;
  startAt: string;
  endAt: string;
  bookerName: string;
  bookerEmail: string;
}

export interface OneTimeLinkListItem {
  eventTypeId: string;
  title: string;
  durationMinutes: number;
  color: string;
  status: OneTimeLinkStatus;
  inviteId: string;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  hiddenGuestsCount: number;
  /** Shareable URL while pending. Null once booked, or for links created before re-copy support. */
  url: string | null;
  /** "Custom hours", or the name of the schedule it follows. */
  availabilityLabel: string;
  booking: OneTimeLinkBooking | null;
  /** Set when the invitation is a group availability poll. */
  groupPoll: {
    responses: number;
    /** How many people are expected, and how many of them have answered. */
    expected: number;
    expectedAnswered: number;
    /** When everyone expected answered (or the deadline passed). */
    readyAt: string | null;
  } | null;
}

export interface OneTimeLinkDetail {
  eventTypeId: string;
  status: OneTimeLinkStatus;
  url: string | null;
  values: {
    title: string;
    durationMinutes: number;
    destinationAccountId: string;
    availability: OneTimeAvailabilityInput;
    hiddenGuests: string[];
    note: string | null;
    expiresAt: string | null;
    descriptionMd: string | null;
    locationKind: OneTimeLinkInput['locationKind'];
    locationValue: string | null;
    bufferBeforeMin: number;
    bufferAfterMin: number;
    minNoticeMin: number;
    bookingWindowDays: number;
    slotIntervalMin: number;
    maxGuests: number;
    confirmationMd: string | null;
    sendReminders: boolean;
    brandId: string | null;
    groupPoll: GroupPollSettings;
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function canonicalizeEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function parseEmails(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

// url-safe random suffix — lowercase alphanumeric only so it matches the
// event-type slug regex. The slug is unreachable anyway (inviteOnly 404s it).
function randomSlugSuffix(bytes = 6): string {
  return randomBytes(bytes)
    .toString('base64')
    .replace(/[+/=]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
    .padEnd(8, '0');
}

async function pickFreeSlug(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `ot-${randomSlugSuffix()}`;
    const taken = await db.eventType.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Vanishingly unlikely — 8 attempts × 36^8 keyspace. Fail loudly if it happens.
  throw new Error('Could not allocate a free one-time slug');
}

function isInviteUsable(
  invite: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): boolean {
  if (invite.usedAt || invite.revokedAt) return false;
  return !invite.expiresAt || invite.expiresAt.getTime() > now.getTime();
}

function inviteUrl(base: string, tokenEnc: string | null): string | null {
  if (!tokenEnc) return null;
  try {
    return `${base}/i/${decrypt(tokenEnc)}`;
  } catch (err) {
    // Encryption key rotated since the link was minted — the link still
    // works for whoever has it, we just can't show it again.
    logger.warn({ event: 'one_time.token_decrypt_failed', err: String(err) }, 'cannot decrypt invite token');
    return null;
  }
}

async function resolveDestination(accountId: string): Promise<string> {
  try {
    return await resolveDefaultCalendarId(accountId);
  } catch (err) {
    if (err instanceof DefaultCalendarError) throw new OneTimeLinkError(err.message, 400);
    throw err;
  }
}

async function validateBrand(userId: string, brandId: string | null | undefined): Promise<void> {
  if (!brandId) return;
  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { userId: true } });
  if (!brand || brand.userId !== userId) throw new OneTimeLinkError('Brand not found', 400);
}

/** Validate a "reuse an existing schedule" choice; returns the schedule id to store. */
async function resolveSharedSchedule(
  userId: string,
  scheduleId: string | null | undefined,
): Promise<string | null> {
  if (!scheduleId) {
    const def = await db.schedule.findFirst({
      where: { userId, isDefault: true },
      select: { id: true },
    });
    // No default yet → the booking flow simply produces no slots, same as
    // a regular event type.
    return def?.id ?? null;
  }
  const owned = await db.schedule.findFirst({
    where: { id: scheduleId, userId, isOneTime: false },
    select: { id: true },
  });
  if (!owned) throw new OneTimeLinkError('Schedule not found', 400);
  return owned.id;
}

type CustomAvailability = Extract<OneTimeAvailabilityInput, { kind: 'custom' }>;

function overrideRows(scheduleId: string, availability: CustomAvailability) {
  return availability.overrides.map((o) => ({
    scheduleId,
    // Same storage convention as the admin overrides API: midnight UTC of
    // the calendar date.
    date: new Date(`${o.date}T00:00:00Z`),
    isBlocked: o.isBlocked,
    startMinute: o.isBlocked ? null : (o.startMinute ?? null),
    endMinute: o.isBlocked ? null : (o.endMinute ?? null),
    source: 'manual',
  }));
}

async function createPrivateSchedule(
  tx: Prisma.TransactionClient,
  userId: string,
  title: string,
  availability: CustomAvailability,
): Promise<string> {
  const schedule = await tx.schedule.create({
    data: {
      userId,
      name: `Invitation: ${title}`.slice(0, 100),
      isDefault: false,
      isOneTime: true,
      timezone: availability.timezone,
      rules: { create: availability.rules },
    },
    select: { id: true },
  });
  const overrides = overrideRows(schedule.id, availability);
  if (overrides.length > 0) await tx.dateOverride.createMany({ data: overrides });
  return schedule.id;
}

async function replacePrivateSchedule(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  title: string,
  availability: CustomAvailability,
): Promise<void> {
  await tx.schedule.update({
    where: { id: scheduleId },
    data: { name: `Invitation: ${title}`.slice(0, 100), timezone: availability.timezone },
  });
  await tx.scheduleRule.deleteMany({ where: { scheduleId } });
  await tx.dateOverride.deleteMany({ where: { scheduleId } });
  if (availability.rules.length > 0) {
    await tx.scheduleRule.createMany({
      data: availability.rules.map((r) => ({ scheduleId, ...r })),
    });
  }
  const overrides = overrideRows(scheduleId, availability);
  if (overrides.length > 0) await tx.dateOverride.createMany({ data: overrides });
}

/** Event-type columns driven directly by the form. */
function eventTypeFields(input: OneTimeLinkInput, destinationCalendarId: string) {
  const needsLocationValue = input.locationKind === 'in_person' || input.locationKind === 'custom_link';
  return {
    title: input.title,
    descriptionMd: input.descriptionMd?.trim() || null,
    durationMinutes: input.durationMinutes,
    destinationAccountId: input.destinationAccountId,
    destinationCalendarId,
    locationKind: input.locationKind,
    locationValue: needsLocationValue ? input.locationValue?.trim() || null : null,
    bufferBeforeMin: input.bufferBeforeMin,
    bufferAfterMin: input.bufferAfterMin,
    minNoticeMin: input.minNoticeMin,
    bookingWindowDays: input.bookingWindowDays,
    // A group booking invites every participant: booker + the rest as guests.
    maxGuests: input.groupPoll.enabled ? MAX_POLL_PARTICIPANTS - 1 : input.maxGuests,
    slotIntervalMin: input.slotIntervalMin,
    confirmationMd: input.confirmationMd?.trim() || null,
    sendReminders: input.sendReminders,
    hiddenGuestsJson: JSON.stringify(canonicalizeEmails(input.hiddenGuests)),
    brandId: input.brandId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────

/** The stored form of the group-poll settings. */
function pollSettings(settings: GroupPollSettings) {
  return {
    showNames: settings.showNames,
    allowGoogle: settings.allowGoogle,
    expectedJson: JSON.stringify(settings.expected),
    answerBy: settings.answerBy ? new Date(settings.answerBy) : null,
    autoBook: settings.autoBook,
  };
}

async function pollSummary(
  poll: { id: string; expectedJson: string; readyAt: Date | null; _count: { participants: number } },
  pending: boolean,
  now: Date,
): Promise<NonNullable<OneTimeLinkListItem['groupPoll']>> {
  const expected = parseEmails(poll.expectedJson).map((e) => e.toLowerCase());
  // Same rule as readiness and the answers dialog: only answers that mark a
  // current time count, so the list never claims "everyone" too early.
  const answered =
    pending && expected.length > 0 ? await answeredEmails(poll.id, now) : new Set<string>();
  return {
    responses: poll._count.participants,
    expected: expected.length,
    expectedAnswered: expected.filter((e) => answered.has(e)).length,
    readyAt: poll.readyAt?.toISOString() ?? null,
  };
}

export async function createOneTimeLink(
  userId: string,
  input: OneTimeLinkInput,
): Promise<{ eventTypeId: string; inviteId: string; url: string; expiresAt: string | null }> {
  const destinationCalendarId = await resolveDestination(input.destinationAccountId);
  await validateBrand(userId, input.brandId);
  const sharedScheduleId =
    input.availability.kind === 'schedule'
      ? await resolveSharedSchedule(userId, input.availability.scheduleId)
      : null;

  const slug = await pickFreeSlug();
  const { token: rawToken, hash: tokenHash } = generateToken(32);

  const { eventType, invite } = await db.$transaction(async (tx) => {
    const scheduleId =
      input.availability.kind === 'custom'
        ? await createPrivateSchedule(tx, userId, input.title, input.availability)
        : sharedScheduleId;
    const et = await tx.eventType.create({
      data: {
        ...eventTypeFields(input, destinationCalendarId),
        userId,
        slug,
        color: '#4F6CFF',
        hidden: true,
        inviteOnly: true,
        isOneTime: true,
        scheduleId,
        position: 0,
        archived: false,
      },
    });
    const inv = await tx.bookingInvite.create({
      data: {
        eventTypeId: et.id,
        tokenHash,
        tokenEnc: encrypt(rawToken),
        note: input.note?.trim() || null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        hiddenGuestsJson: '[]', // event-type defaults already carry the cc list
      },
    });
    if (input.groupPoll.enabled) {
      await tx.groupPoll.create({ data: { eventTypeId: et.id, ...pollSettings(input.groupPoll) } });
    }
    return { eventType: et, invite: inv };
  });

  const base = await getPublicUrl();
  return {
    eventTypeId: eventType.id,
    inviteId: invite.id,
    url: `${base}/i/${rawToken}`,
    expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────

async function loadOwned(userId: string, eventTypeId: string, now: Date) {
  const eventType = await db.eventType.findFirst({
    where: { id: eventTypeId, userId, isOneTime: true },
    include: {
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      bookings: {
        where: { status: { in: LIVE_BOOKING_STATUSES }, endAt: { gt: now } },
        orderBy: { startAt: 'asc' },
        take: 1,
      },
      schedule: {
        include: {
          rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
          overrides: { orderBy: { date: 'asc' } },
        },
      },
      groupPoll: { include: { _count: { select: { participants: true } } } },
    },
  });
  if (!eventType) throw new OneTimeLinkError('Invitation not found', 404);
  return eventType;
}

export async function getOneTimeLink(
  userId: string,
  eventTypeId: string,
  now: Date = new Date(),
): Promise<OneTimeLinkDetail> {
  const et = await loadOwned(userId, eventTypeId, now);
  const invite = et.invites[0];
  const booked = et.bookings.length > 0;
  if (!invite || (!booked && !isInviteUsable(invite, now))) {
    throw new OneTimeLinkError('Invitation not found', 404);
  }

  const availability: OneTimeAvailabilityInput = et.schedule?.isOneTime
    ? {
        kind: 'custom',
        timezone: et.schedule.timezone,
        rules: et.schedule.rules.map((r) => ({
          weekday: r.weekday,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        })),
        overrides: et.schedule.overrides.map((o) => ({
          date: DateTime.fromJSDate(o.date, { zone: 'utc' }).toISODate() ?? '',
          isBlocked: o.isBlocked,
          ...(o.isBlocked ? {} : { startMinute: o.startMinute ?? 0, endMinute: o.endMinute ?? 0 }),
        })),
      }
    : { kind: 'schedule', scheduleId: et.schedule?.isDefault ? null : (et.scheduleId ?? null) };

  const base = await getPublicUrl();
  return {
    eventTypeId: et.id,
    status: booked ? 'booked' : 'pending',
    url: booked ? null : inviteUrl(base, invite.tokenEnc),
    values: {
      title: et.title,
      durationMinutes: et.durationMinutes,
      destinationAccountId: et.destinationAccountId,
      availability,
      hiddenGuests: parseEmails(et.hiddenGuestsJson),
      note: invite.note,
      expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
      descriptionMd: et.descriptionMd,
      locationKind: et.locationKind as OneTimeLinkInput['locationKind'],
      locationValue: et.locationValue,
      bufferBeforeMin: et.bufferBeforeMin,
      bufferAfterMin: et.bufferAfterMin,
      minNoticeMin: et.minNoticeMin,
      bookingWindowDays: et.bookingWindowDays,
      slotIntervalMin: et.slotIntervalMin,
      maxGuests: et.maxGuests,
      confirmationMd: et.confirmationMd,
      sendReminders: et.sendReminders,
      brandId: et.brandId,
      groupPoll: et.groupPoll
        ? {
            enabled: true,
            showNames: et.groupPoll.showNames,
            allowGoogle: et.groupPoll.allowGoogle,
            expected: parseEmails(et.groupPoll.expectedJson),
            answerBy: et.groupPoll.answerBy?.toISOString() ?? null,
            autoBook: et.groupPoll.autoBook,
          }
        : { enabled: false, showNames: true, allowGoogle: true, expected: [], answerBy: null, autoBook: false },
    },
  };
}

/**
 * Invitations the admin still has to care about: pending links and booked
 * meetings that haven't ended. Everything else silently drops out.
 */
export async function listOneTimeLinks(
  userId: string,
  now: Date = new Date(),
): Promise<OneTimeLinkListItem[]> {
  const rows = await db.eventType.findMany({
    where: {
      userId,
      isOneTime: true,
      archived: false,
      OR: [
        {
          invites: {
            some: {
              usedAt: null,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        },
        { bookings: { some: { status: { in: LIVE_BOOKING_STATUSES }, endAt: { gt: now } } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      bookings: {
        where: { status: { in: LIVE_BOOKING_STATUSES }, endAt: { gt: now } },
        orderBy: { startAt: 'asc' },
        take: 1,
      },
      schedule: { select: { name: true, isOneTime: true, isDefault: true } },
      groupPoll: {
        select: { id: true, expectedJson: true, readyAt: true, _count: { select: { participants: true } } },
      },
    },
  });

  const base = await getPublicUrl();
  const items: OneTimeLinkListItem[] = [];
  for (const row of rows) {
    const invite = row.invites[0];
    if (!invite) continue;
    const booking = row.bookings[0] ?? null;
    const pending = !booking && isInviteUsable(invite, now);
    if (!booking && !pending) continue;

    items.push({
      eventTypeId: row.id,
      title: row.title,
      durationMinutes: row.durationMinutes,
      color: row.color,
      status: booking ? 'booked' : 'pending',
      inviteId: invite.id,
      note: invite.note,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
      hiddenGuestsCount: parseEmails(row.hiddenGuestsJson).length,
      url: pending ? inviteUrl(base, invite.tokenEnc) : null,
      availabilityLabel: row.schedule?.isOneTime
        ? 'Custom hours'
        : row.schedule && !row.schedule.isDefault
          ? row.schedule.name
          : 'Default schedule',
      booking: booking
        ? {
            id: booking.id,
            startAt: booking.startAt.toISOString(),
            endAt: booking.endAt.toISOString(),
            bookerName: booking.bookerName,
            bookerEmail: booking.bookerEmail,
          }
        : null,
      groupPoll: row.groupPoll ? await pollSummary(row.groupPoll, pending, now) : null,
    });
  }
  return items;
}

// ─────────────────────────────────────────────────────────────
// Update — only while the link is still pending
// ─────────────────────────────────────────────────────────────

const NOT_EDITABLE = 'This invitation has already been booked and can no longer be edited.';

export async function updateOneTimeLink(
  userId: string,
  eventTypeId: string,
  input: OneTimeLinkInput,
  now: Date = new Date(),
): Promise<void> {
  const et = await loadOwned(userId, eventTypeId, now);
  const invite = et.invites[0];
  if (!invite) throw new OneTimeLinkError('Invitation not found', 404);
  if (invite.usedAt || et.bookings.length > 0) throw new OneTimeLinkError(NOT_EDITABLE, 409);
  if (!isInviteUsable(invite, now)) {
    throw new OneTimeLinkError('This invitation has expired or was revoked.', 409);
  }

  const destinationCalendarId = await resolveDestination(input.destinationAccountId);
  await validateBrand(userId, input.brandId);
  const sharedScheduleId =
    input.availability.kind === 'schedule'
      ? await resolveSharedSchedule(userId, input.availability.scheduleId)
      : null;
  const previousPrivateScheduleId = et.schedule?.isOneTime ? et.schedule.id : null;
  if (et.groupPoll && !input.groupPoll.enabled && et.groupPoll._count.participants > 0) {
    throw new OneTimeLinkError(
      'People have already answered this poll. Delete the invitation to start over.',
      409,
    );
  }
  // Answers are "I can make the meeting starting at …" for this length; a
  // longer meeting would book people for time they never agreed to.
  if (
    et.groupPoll &&
    et.groupPoll._count.participants > 0 &&
    input.durationMinutes !== et.durationMinutes
  ) {
    throw new OneTimeLinkError(
      "People have already answered this poll, so the meeting length can't change. Delete the invitation to start over.",
      409,
    );
  }
  // Only a change in who's expected or the deadline (or switching auto-book
  // on) re-arms "ready"; other edits leave it as it is.
  const nextPoll = pollSettings(input.groupPoll);
  const rearm =
    !et.groupPoll ||
    et.groupPoll.expectedJson !== nextPoll.expectedJson ||
    (et.groupPoll.answerBy?.getTime() ?? null) !== (nextPoll.answerBy?.getTime() ?? null) ||
    (!et.groupPoll.autoBook && nextPoll.autoBook);

  await db.$transaction(async (tx) => {
    // Guard against a booking landing between our read and this write: the
    // conditional update only matches while the invite is still unused, and
    // SQLite serialises writers, so a concurrent claim either happened
    // before (count = 0 → abort) or waits for us to commit.
    const guard = await tx.bookingInvite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: {
        note: input.note?.trim() || null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    if (guard.count !== 1) throw new OneTimeLinkError(NOT_EDITABLE, 409);

    let scheduleId: string | null;
    if (input.availability.kind === 'custom') {
      if (previousPrivateScheduleId) {
        await replacePrivateSchedule(tx, previousPrivateScheduleId, input.title, input.availability);
        scheduleId = previousPrivateScheduleId;
      } else {
        scheduleId = await createPrivateSchedule(tx, userId, input.title, input.availability);
      }
    } else {
      scheduleId = sharedScheduleId;
    }

    await tx.eventType.update({
      where: { id: et.id },
      data: { ...eventTypeFields(input, destinationCalendarId), scheduleId },
    });

    if (previousPrivateScheduleId && scheduleId !== previousPrivateScheduleId) {
      await tx.schedule.delete({ where: { id: previousPrivateScheduleId } });
    }

    if (input.groupPoll.enabled) {
      // Re-armed polls are checked again right after the edit.
      const settings = { ...nextPoll, ...(rearm ? { readyAt: null } : {}) };
      await tx.groupPoll.upsert({
        where: { eventTypeId: et.id },
        create: { eventTypeId: et.id, ...settings },
        update: settings,
      });
    } else if (et.groupPoll) {
      // Re-checked here so an answer landing mid-edit isn't silently dropped.
      const answered = await tx.pollParticipant.count({ where: { pollId: et.groupPoll.id } });
      if (answered > 0) {
        throw new OneTimeLinkError(
          'People have already answered this poll. Delete the invitation to start over.',
          409,
        );
      }
      await tx.groupPoll.delete({ where: { id: et.groupPoll.id } });
    }
  });

  // Hours / duration / buffers may all have changed — drop cached slots so
  // the invitee sees the new availability immediately.
  invalidateSlotCache(et.id);

  // New expected people or deadline: the poll may be ready right away.
  if (input.groupPoll.enabled && rearm) {
    const poll = await db.groupPoll.findUnique({ where: { eventTypeId: et.id }, select: { id: true } });
    if (poll) await checkPollReady(poll.id, now);
  }
}

// ─────────────────────────────────────────────────────────────
// Delete — pending invitations only. A booked invitation ends by
// cancelling its meeting instead.
// ─────────────────────────────────────────────────────────────

export async function deleteOneTimeLink(
  userId: string,
  eventTypeId: string,
  now: Date = new Date(),
): Promise<void> {
  const et = await loadOwned(userId, eventTypeId, now);
  if (et.bookings.length > 0) {
    throw new OneTimeLinkError(
      'This invitation has an upcoming meeting. Cancel the meeting instead.',
      409,
    );
  }
  const privateScheduleId = et.schedule?.isOneTime ? et.schedule.id : null;

  await db.$transaction(async (tx) => {
    // Re-check inside the transaction so a booking that lands mid-delete
    // isn't wiped by the event-type cascade.
    const live = await tx.booking.count({
      where: { eventTypeId: et.id, status: { in: LIVE_BOOKING_STATUSES }, endAt: { gt: now } },
    });
    if (live > 0) {
      throw new OneTimeLinkError(
        'This invitation has an upcoming meeting. Cancel the meeting instead.',
        409,
      );
    }
    await tx.eventType.delete({ where: { id: et.id } });
    if (privateScheduleId) await tx.schedule.delete({ where: { id: privateScheduleId } });
  });

  invalidateSlotCache(et.id);
}
