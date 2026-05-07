/**
 * Reschedule a booking to a new start instant.
 *
 * The booker submits only the new `startAt`; we keep every other field intact.
 * The Google patch deliberately omits `conferenceData` so the existing Google
 * Meet link is preserved (replacing it would invalidate any join URLs already
 * shared via the original invite email).
 *
 * Flow:
 *   1. Validate (caller already ran Zod).
 *   2. Look up booking; reject if cancelled.
 *   3. Re-check slot availability via `computeSlots` for the new window.
 *   4. Inside a transaction: update startAt/endAt, status=rescheduled, write
 *      BookingHistory with before/after.
 *   5. Outside the transaction, patch Google with the new times. If patch
 *      succeeds, flip status back to 'confirmed' so the booking reads cleanly.
 *      If it fails, record `needsSync=true`; we don't roll back the local
 *      change because the source of truth is Slotty's DB.
 *   6. Invalidate slot cache.
 */
import type { Booking, EventType, EventTypeQuestion } from '@prisma/client';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { computeSlots } from '@/lib/scheduling/compute';
import { invalidate as invalidateSlotCache } from '@/lib/scheduling/cache';
import { patchEvent } from '@/lib/google/calendar';

export interface RescheduleBookingArgs {
  bookingId: string;
  newStartAtIso: string;
  actor: 'booker' | 'owner' | 'system';
}

export class BookingNotFoundError extends Error {
  constructor() {
    super('Booking not found');
    this.name = 'BookingNotFoundError';
  }
}

export class BookingAlreadyCancelledError extends Error {
  constructor() {
    super('Booking is cancelled and cannot be rescheduled');
    this.name = 'BookingAlreadyCancelledError';
  }
}

export class SlotUnavailableError extends Error {
  constructor() {
    super('The requested time slot is no longer available');
    this.name = 'SlotUnavailableError';
  }
}

export interface RescheduleResult {
  booking: Booking;
  previousStart: Date;
  previousEnd: Date;
}

const RECHECK_WINDOW_DAYS = 2;

async function assertSlotAvailable(
  eventType: EventType & { questions: EventTypeQuestion[] },
  ownerId: string,
  startAt: Date,
  bookerTz: string,
): Promise<void> {
  const owner = await db.user.findUnique({ where: { id: ownerId } });
  if (!owner) throw new SlotUnavailableError();

  const from = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(startAt.getTime() + RECHECK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const slots = await computeSlots({
    eventType,
    user: owner,
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
  throw new SlotUnavailableError();
}

export async function rescheduleBooking(
  args: RescheduleBookingArgs,
): Promise<RescheduleResult> {
  const { bookingId, newStartAtIso, actor } = args;

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { eventType: { include: { questions: { orderBy: { position: 'asc' } } } } },
  });
  if (!booking) throw new BookingNotFoundError();
  if (booking.status === 'cancelled') throw new BookingAlreadyCancelledError();

  const newStart = new Date(newStartAtIso);
  if (Number.isNaN(newStart.getTime())) throw new SlotUnavailableError();
  const newEnd = new Date(newStart.getTime() + booking.eventType.durationMinutes * 60 * 1000);

  // No-op shortcut if the times haven't changed (idempotent click protection).
  if (
    newStart.getTime() === booking.startAt.getTime() &&
    newEnd.getTime() === booking.endAt.getTime()
  ) {
    return {
      booking,
      previousStart: booking.startAt,
      previousEnd: booking.endAt,
    };
  }

  await assertSlotAvailable(booking.eventType, booking.eventType.userId, newStart, booking.bookerTimezone);

  const previousStart = booking.startAt;
  const previousEnd = booking.endAt;

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.booking.update({
      where: { id: bookingId },
      data: {
        startAt: newStart,
        endAt: newEnd,
        status: 'rescheduled',
      },
    });
    await tx.bookingHistory.create({
      data: {
        bookingId,
        action: 'rescheduled',
        payloadJson: JSON.stringify({
          before: {
            startAt: previousStart.toISOString(),
            endAt: previousEnd.toISOString(),
          },
          after: {
            startAt: newStart.toISOString(),
            endAt: newEnd.toISOString(),
          },
        }),
        actor,
      },
    });
    return next;
  });

  // Patch Google. Deliberately do NOT include conferenceData so the existing
  // Meet link is preserved. We pass timezone from the booker so Google emails
  // include the booker's local time.
  let final = updated;
  if (booking.googleEventId) {
    const calendar = await db.calendar.findUnique({
      where: { id: booking.googleCalendarId },
    });
    const remoteCalId = calendar?.googleCalendarId ?? '';
    try {
      await patchEvent(
        booking.googleAccountId,
        remoteCalId,
        booking.googleEventId,
        {
          start: { dateTime: newStart.toISOString(), timeZone: booking.bookerTimezone },
          end: { dateTime: newEnd.toISOString(), timeZone: booking.bookerTimezone },
        },
        { sendUpdates: 'all' },
      );
      final = await db.booking.update({
        where: { id: bookingId },
        data: { status: 'confirmed', needsSync: false, syncError: null },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { event: 'booking.google_patch_failed', bookingId, err: msg },
        'Google patchEvent failed during reschedule; booking marked needs_sync',
      );
      final = await db.booking.update({
        where: { id: bookingId },
        data: { needsSync: true, syncError: `reschedule: ${msg.slice(0, 480)}` },
      });
    }
  } else {
    // No Google event was ever created (the original create failed). Just
    // settle the status back to confirmed so the row presents cleanly; the
    // booking_sync_retry job will eventually try the original insert.
    final = await db.booking.update({
      where: { id: bookingId },
      data: { status: 'confirmed' },
    });
  }

  invalidateSlotCache(booking.eventTypeId);

  return { booking: final, previousStart, previousEnd };
}
