/**
 * Booking creation pipeline.
 *
 * The flow:
 *   1. Validate input (caller already ran the Zod schema).
 *   2. Look up the EventType by slug (404 / archived → throw).
 *   3. Verify the password if the event type is gated.
 *   4. Idempotency: if a booking with the same (eventTypeId, clientRequestId)
 *      already exists, return it unchanged.
 *   5. Inside a Prisma transaction, re-compute slots over a tight window and
 *      insist the requested startAt is currently a valid candidate. This is
 *      our race-condition guard against two bookers racing for the same slot.
 *      Then insert the Booking row with status='confirmed' and freshly
 *      generated cancel + reschedule tokens (raw hashes only stored).
 *   6. Outside the transaction, hit Google Calendar to insert the event,
 *      requesting a Meet link if locationKind === 'google_meet'. On success
 *      stash the googleEventId and meetingUrl on the booking row. On failure,
 *      keep the booking but mark `needsSync=true` so the admin can retry.
 *   7. Invalidate the slot cache so the next slot fetch reflects the new busy.
 *   8. Write a BookingHistory row (action='created').
 *   9. Return the booking + raw tokens (so the API route can build the
 *      management URL and surface meetingUrl).
 *
 * Slot cache invalidation, idempotency, and the slot re-check are the three
 * load-bearing correctness properties here; the rest is plumbing.
 */
import type { calendar_v3 } from 'googleapis';
import type { Booking, EventType, EventTypeQuestion, User } from '@prisma/client';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { generateToken } from '@/lib/crypto';
import { verifyPassword } from '@/lib/auth/password';
import { computeSlots } from '@/lib/scheduling/compute';
import { invalidate as invalidateSlotCache } from '@/lib/scheduling/cache';
import { insertEvent, extractMeetingUrl } from '@/lib/google/calendar';
import { emit } from '@/lib/webhooks/emit';
import { getPublicUrl } from '@/lib/site-url/store';
import { resolveInviteByRawToken, claimInviteAtomically } from './invite';
import { parseHiddenGuests } from '@/lib/eventtype/service';

export type EventTypeWithQuestions = EventType & { questions: EventTypeQuestion[] };

export interface CreateBookingInput {
  /** Either eventTypeSlug or inviteToken must be provided. */
  eventTypeSlug?: string;
  /** Raw one-time invite token. When present, slug is ignored and the password gate is skipped. */
  inviteToken?: string;
  startAtIso: string;
  bookerName: string;
  bookerEmail: string;
  bookerTimezone: string;
  additionalGuests?: string[];
  notes?: string;
  answers?: Record<string, string>;
  clientRequestId?: string;
  password?: string;
}

export interface CreatedBooking {
  booking: Booking;
  rawCancelToken: string;
  rawRescheduleToken: string;
  /** True if the row was already present (idempotent replay). */
  idempotentReplay: boolean;
  /** True if Google insert failed and the booking is awaiting retry. */
  needsSync: boolean;
}

export class BookingError extends Error {
  constructor(
    message: string,
    public readonly code: BookingErrorCode,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

export type BookingErrorCode =
  | 'EVENT_TYPE_NOT_FOUND'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_INVALID'
  | 'SLOT_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'TOO_MANY_GUESTS'
  | 'OWNER_MISSING'
  | 'INVITE_NOT_FOUND'
  | 'INVITE_UNAVAILABLE'
  | 'INVITE_ONLY';

const RECHECK_WINDOW_DAYS = 2;

async function makeManageUrl(bookingId: string, rescheduleToken: string): Promise<string> {
  const base = await getPublicUrl();
  return `${base}/b/${bookingId}?t=${rescheduleToken}`;
}

/**
 * Build the Google `Schema$Event` payload for an insert. The location field
 * depends on `locationKind`; conferenceData (for Google Meet) is requested
 * only when explicitly chosen — Google generates the link server-side.
 */
function buildGoogleEventPayload(args: {
  eventType: EventType;
  ownerEmail: string;
  bookingId: string;
  bookerName: string;
  bookerEmail: string;
  bookerTimezone: string;
  startAt: Date;
  endAt: Date;
  additionalGuests: string[];
  notes: string | undefined;
  answers: Record<string, string>;
  questions: EventTypeQuestion[];
  manageUrl: string;
}): calendar_v3.Schema$Event {
  const {
    eventType,
    ownerEmail,
    bookingId,
    bookerName,
    bookerEmail,
    bookerTimezone,
    startAt,
    endAt,
    additionalGuests,
    notes,
    answers,
    questions,
    manageUrl,
  } = args;

  const descriptionParts: string[] = [];
  if (notes && notes.trim()) {
    descriptionParts.push('Notes from booker:');
    descriptionParts.push(notes.trim());
    descriptionParts.push('');
  }
  if (questions.length > 0) {
    const lines: string[] = [];
    for (const q of questions) {
      const a = answers[q.id];
      if (a !== undefined && a !== '') {
        lines.push(`${q.label}: ${a}`);
      }
    }
    if (lines.length > 0) {
      descriptionParts.push('Booker responses:');
      descriptionParts.push(...lines);
      descriptionParts.push('');
    }
  }
  descriptionParts.push(`Manage this booking: ${manageUrl}`);

  // Owner is always organizer & first attendee. Booker + additional guests
  // come after. We ask Google to respond with sendUpdates: 'all' which mails
  // every attendee an invite — that's our "no SMTP" trick for transactional
  // notification.
  const attendees: calendar_v3.Schema$EventAttendee[] = [
    { email: ownerEmail, organizer: true, responseStatus: 'accepted' },
    { email: bookerEmail, displayName: bookerName, responseStatus: 'needsAction' },
  ];
  for (const g of additionalGuests) {
    attendees.push({ email: g, responseStatus: 'needsAction' });
  }

  const payload: calendar_v3.Schema$Event = {
    summary: `${eventType.title} with ${bookerName}`,
    description: descriptionParts.join('\n'),
    start: {
      dateTime: startAt.toISOString(),
      timeZone: bookerTimezone,
    },
    end: {
      dateTime: endAt.toISOString(),
      timeZone: bookerTimezone,
    },
    attendees,
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        slottyBookingId: bookingId,
      },
    },
  };

  switch (eventType.locationKind) {
    case 'google_meet':
      payload.conferenceData = {
        createRequest: {
          requestId: bookingId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
      break;
    case 'in_person':
      if (eventType.locationValue) payload.location = eventType.locationValue;
      break;
    case 'phone':
      payload.location = 'Phone (booker provides)';
      break;
    case 'custom_link':
      if (eventType.locationValue) payload.location = eventType.locationValue;
      break;
    default:
      break;
  }

  return payload;
}

/**
 * Slot re-check. Recomputes slots in a small window centred on `startAt`
 * (with `noCache: true`) and asserts the requested instant matches one of the
 * candidates exactly. The window is wide enough to cover the slice but tight
 * enough that the recomputation cost is minimal.
 */
async function assertSlotStillAvailable(
  eventType: EventType,
  user: User,
  startAt: Date,
  bookerTz: string,
): Promise<void> {
  const from = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(startAt.getTime() + RECHECK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const slots = await computeSlots({
    eventType,
    user,
    from,
    to,
    bookerTz,
    noCache: true,
  });
  const targetIso = startAt.toISOString();
  for (const day of slots.days) {
    for (const s of day.slots) {
      if (s.startUtc === targetIso) return;
    }
  }
  throw new BookingError(
    'The requested time slot is no longer available. Please pick another time.',
    'SLOT_UNAVAILABLE',
    409,
  );
}

/**
 * Public entry-point. The Zod-validated input is assumed; this function does
 * not re-shape the input.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
  // Resolve via invite token first (if provided) — the token replaces both
  // slug-based lookup and the password gate. Slug presence on an invite-mode
  // request is ignored.
  let eventType: (EventType & { questions: EventTypeQuestion[] }) | null = null;
  let inviteId: string | null = null;
  let inviteHiddenGuestsJson: string | null = null;

  if (input.inviteToken) {
    const resolved = await resolveInviteByRawToken(input.inviteToken);
    if (resolved.status !== 'ok' || !resolved.invite || !resolved.eventType) {
      // Distinguish "this token never existed" (NOT_FOUND, 404) from
      // "this token exists but is no longer usable" (UNAVAILABLE, 410).
      if (resolved.status === 'not_found') {
        throw new BookingError('Invite link not found', 'INVITE_NOT_FOUND', 404);
      }
      throw new BookingError('This invite link is no longer available.', 'INVITE_UNAVAILABLE', 410);
    }
    eventType = resolved.eventType;
    inviteId = resolved.invite.id;
    inviteHiddenGuestsJson = resolved.invite.hiddenGuestsJson;
  } else {
    if (!input.eventTypeSlug) {
      throw new BookingError('Missing eventTypeSlug or inviteToken', 'INVALID_INPUT', 400);
    }
    eventType = await db.eventType.findUnique({
      where: { slug: input.eventTypeSlug },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!eventType || eventType.archived) {
      throw new BookingError('Event type not found', 'EVENT_TYPE_NOT_FOUND', 404);
    }
    // Slug-based access is rejected when the event type is invite-only —
    // the only legitimate path is /i/<token> with a valid invite.
    if (eventType.inviteOnly) {
      throw new BookingError('This event type is invite-only.', 'INVITE_ONLY', 404);
    }
    // Password gate (skipped on invite-mode requests; the token is the credential).
    if (eventType.passwordHash) {
      if (!input.password) {
        throw new BookingError('Password required', 'PASSWORD_REQUIRED', 401);
      }
      const ok = await verifyPassword(eventType.passwordHash, input.password);
      if (!ok) {
        throw new BookingError('Invalid password', 'PASSWORD_INVALID', 401);
      }
    }
  }
  if (!eventType || eventType.archived) {
    throw new BookingError('Event type not found', 'EVENT_TYPE_NOT_FOUND', 404);
  }

  // Owner — needed both for slot computation and to set organizer on Google.
  const owner = await db.user.findUnique({ where: { id: eventType.userId } });
  if (!owner) {
    throw new BookingError('Owner missing', 'OWNER_MISSING', 500);
  }

  const startAt = new Date(input.startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    throw new BookingError('Invalid startAt', 'INVALID_INPUT', 400);
  }
  const endAt = new Date(startAt.getTime() + eventType.durationMinutes * 60 * 1000);

  // Enforce the per-event-type guest cap. The endpoint already bounds the array
  // at 20; this further narrows it to whatever the owner configured (default 3).
  const guestCount = (input.additionalGuests ?? []).filter((s) => typeof s === 'string' && s).length;
  if (guestCount > eventType.maxGuests) {
    throw new BookingError(
      `This event type allows at most ${eventType.maxGuests} additional guest${eventType.maxGuests === 1 ? '' : 's'}.`,
      'TOO_MANY_GUESTS',
      400,
    );
  }

  // Idempotency: if (eventTypeId, clientRequestId) already exists, return it.
  if (input.clientRequestId) {
    const existing = await db.booking.findUnique({
      where: {
        eventTypeId_clientRequestId: {
          eventTypeId: eventType.id,
          clientRequestId: input.clientRequestId,
        },
      },
    });
    if (existing) {
      return {
        booking: existing,
        // Tokens are unrecoverable from hash; on idempotent replay we only
        // expose the row. Original client already received the raw tokens
        // in the first response — replays don't get them again.
        rawCancelToken: '',
        rawRescheduleToken: '',
        idempotentReplay: true,
        needsSync: existing.needsSync,
      };
    }
  }

  // Generate tokens before the transaction — both halves of the create are
  // idempotent if anything fails before commit.
  const cancelTok = generateToken(32);
  const rescheduleTok = generateToken(32);

  // Slot re-check + insert in one transaction.
  // Merge guest sources: booker-typed (visible) + event-type defaults + invite-specific
  // override. The latter two are silent — the booker never sees them on the form —
  // but they all end up as Google Calendar attendees and on the booking row's
  // additional_guests_json. Order: booker-typed first (preserves their input),
  // then owner-configured. Case-insensitive dedupe; booker's own email filtered out.
  const eventHiddenGuests = parseHiddenGuests(eventType.hiddenGuestsJson);
  const inviteHiddenGuests = parseHiddenGuests(inviteHiddenGuestsJson);
  const bookerEmailKey = input.bookerEmail.trim().toLowerCase();
  const seen = new Set<string>([bookerEmailKey]);
  const additionalGuests: string[] = [];
  const HIDDEN_MERGE_HARD_CAP = 20;
  const pushIfNew = (raw: string): void => {
    if (additionalGuests.length >= HIDDEN_MERGE_HARD_CAP) return;
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    additionalGuests.push(trimmed);
  };
  for (const g of input.additionalGuests ?? []) pushIfNew(g);
  for (const g of eventHiddenGuests) pushIfNew(g);
  for (const g of inviteHiddenGuests) pushIfNew(g);

  const answers = input.answers ?? {};

  const eventTypeForTx = eventType;
  const booking = await db.$transaction(async (tx) => {
    // We use the live `db` client for the slot re-check because computeSlots
    // pulls from many tables — the read-after-write race is closed by the
    // unique index on (eventTypeId, clientRequestId) and by the cache
    // invalidation that happens at the end of this function.
    await assertSlotStillAvailable(eventTypeForTx, owner, startAt, input.bookerTimezone);

    const created = await tx.booking.create({
      data: {
        eventTypeId: eventTypeForTx.id,
        googleAccountId: eventTypeForTx.destinationAccountId,
        googleCalendarId: eventTypeForTx.destinationCalendarId,
        startAt,
        endAt,
        status: 'confirmed',
        bookerName: input.bookerName,
        bookerEmail: input.bookerEmail,
        bookerTimezone: input.bookerTimezone,
        additionalGuestsJson: JSON.stringify(additionalGuests),
        notes: input.notes ?? null,
        answersJson: JSON.stringify(answers),
        cancelTokenHash: cancelTok.hash,
        rescheduleTokenHash: rescheduleTok.hash,
        clientRequestId: input.clientRequestId ?? null,
        needsSync: false,
      },
    });

    // Atomic single-use claim. If a concurrent booking already claimed this
    // invite, updateMany returns count=0 and the helper throws — rolling back
    // the booking insert above so we don't leave an orphan row.
    if (inviteId) {
      await claimInviteAtomically(tx, inviteId, created.id);
    }

    return created;
  });

  // Best-effort Google insert. We resolve the actual googleCalendarId from
  // the destination Calendar row (the FK references our internal id, but the
  // Google API expects Google's id — typically an email-shaped string).
  const destinationCalendar = await db.calendar.findUnique({
    where: { id: eventType.destinationCalendarId },
  });
  const googleCalendarRemoteId = destinationCalendar?.googleCalendarId ?? '';

  const ownerEmailForOrganizer =
    (await db.connectedAccount.findUnique({ where: { id: eventType.destinationAccountId } }))
      ?.googleUserEmail ?? owner.email;

  const manageUrl = await makeManageUrl(booking.id, rescheduleTok.token);
  const googlePayload = buildGoogleEventPayload({
    eventType,
    ownerEmail: ownerEmailForOrganizer,
    bookingId: booking.id,
    bookerName: input.bookerName,
    bookerEmail: input.bookerEmail,
    bookerTimezone: input.bookerTimezone,
    startAt,
    endAt,
    additionalGuests,
    notes: input.notes,
    answers,
    questions: eventType.questions,
    manageUrl,
  });

  let needsSync = false;
  let updated = booking;
  let resolvedMeetingUrl: string | null = null;

  try {
    const googleEvent = await insertEvent(
      eventType.destinationAccountId,
      googleCalendarRemoteId,
      googlePayload,
      { sendUpdates: 'all' },
    );
    resolvedMeetingUrl = computeMeetingUrl(eventType, googleEvent);
    updated = await db.booking.update({
      where: { id: booking.id },
      data: {
        googleEventId: googleEvent.id ?? null,
        meetingUrl: resolvedMeetingUrl,
      },
    });
  } catch (err) {
    needsSync = true;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: 'booking.google_insert_failed', bookingId: booking.id, err: msg },
      'Google insertEvent failed; booking marked needs_sync',
    );
    updated = await db.booking.update({
      where: { id: booking.id },
      data: {
        needsSync: true,
        syncError: msg.slice(0, 500),
        // Even without a Google event, surface the static location for kinds
        // that don't depend on Google for the URL.
        meetingUrl: staticLocationUrl(eventType),
      },
    });
    // Schedule a retry job. The job kind is `booking_sync_retry`; the worker
    // implementation can be added in a follow-up. The row is still functional
    // for the booker in the meantime.
    try {
      await db.job.create({
        data: {
          kind: 'booking_sync_retry',
          runAt: new Date(Date.now() + 60_000),
          payloadJson: JSON.stringify({ bookingId: booking.id }),
          status: 'pending',
        },
      });
    } catch (jobErr) {
      logger.warn(
        {
          event: 'booking.retry_enqueue_failed',
          bookingId: booking.id,
          err: jobErr instanceof Error ? jobErr.message : String(jobErr),
        },
        'failed to enqueue booking_sync_retry job',
      );
    }
  }

  // Invalidate slot cache so the next slot read reflects the new booking.
  invalidateSlotCache(eventType.id);

  // History.
  await db.bookingHistory.create({
    data: {
      bookingId: booking.id,
      action: 'created',
      payloadJson: JSON.stringify({
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        bookerEmail: input.bookerEmail,
        needsSync,
      }),
      actor: 'booker',
    },
  });

  // Emit webhook event.
  void emit(owner.id, 'booking.created', {
    bookingId: updated.id,
    eventTypeSlug: eventType.slug,
    bookerName: input.bookerName,
    bookerEmail: input.bookerEmail,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  });

  return {
    booking: updated,
    rawCancelToken: cancelTok.token,
    rawRescheduleToken: rescheduleTok.token,
    idempotentReplay: false,
    needsSync,
  };
}

function computeMeetingUrl(
  eventType: EventType,
  googleEvent: calendar_v3.Schema$Event,
): string | null {
  if (eventType.locationKind === 'google_meet') {
    return extractMeetingUrl(googleEvent);
  }
  if (eventType.locationKind === 'custom_link') {
    return eventType.locationValue ?? null;
  }
  return null;
}

function staticLocationUrl(eventType: EventType): string | null {
  if (eventType.locationKind === 'custom_link') return eventType.locationValue ?? null;
  return null;
}

export { makeManageUrl };
