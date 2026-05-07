/**
 * Cancel a booking.
 *
 * Used by both the public booker flow (with a token check applied at the API
 * route layer) and by the admin owner flow (no token, but `requireUser` +
 * CSRF). The shared logic is:
 *
 *   1. Look up booking. 404 if missing.
 *   2. If already cancelled → idempotent success (no double email, no double
 *      Google delete).
 *   3. Update status='cancelled', cancelledAt=now, cancelReason; write
 *      BookingHistory in the same transaction.
 *   4. Outside the transaction, call Google `events.delete` with
 *      `sendUpdates='all'` so attendees are notified.
 *   5. Invalidate slot cache.
 *
 * The Google delete tolerates 404 / 410 gracefully (already deleted upstream
 * — see calendar.ts).
 */
import type { Booking } from '@prisma/client';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { deleteEvent } from '@/lib/google/calendar';
import { invalidate as invalidateSlotCache } from '@/lib/scheduling/cache';
import { emit } from '@/lib/webhooks/emit';

export interface CancelBookingArgs {
  bookingId: string;
  actor: 'booker' | 'owner' | 'system';
  reason?: string;
}

export class BookingNotFoundError extends Error {
  constructor() {
    super('Booking not found');
    this.name = 'BookingNotFoundError';
  }
}

export interface CancelResult {
  booking: Booking;
  alreadyCancelled: boolean;
}

export async function cancelBooking(args: CancelBookingArgs): Promise<CancelResult> {
  const { bookingId, actor, reason } = args;

  const existing = await db.booking.findUnique({ where: { id: bookingId } });
  if (!existing) throw new BookingNotFoundError();

  if (existing.status === 'cancelled') {
    return { booking: existing, alreadyCancelled: true };
  }

  const previousStatus = existing.status;
  const now = new Date();

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: reason ?? null,
      },
    });
    await tx.bookingHistory.create({
      data: {
        bookingId: bookingId,
        action: 'cancelled',
        payloadJson: JSON.stringify({
          previousStatus,
          reason: reason ?? null,
          cancelledAt: now.toISOString(),
        }),
        actor,
      },
    });
    return next;
  });

  // Best-effort Google delete. If Google fails the booking is still cancelled
  // locally — admin can manually clean up. We don't want to surface 503 to a
  // booker who just clicked "Cancel".
  if (existing.googleEventId) {
    try {
      // The destination Calendar row holds Google's calendar id; the booking
      // stores our internal id (FK), so we resolve the remote id here.
      const calendar = await db.calendar.findUnique({
        where: { id: existing.googleCalendarId },
      });
      const remoteCalId = calendar?.googleCalendarId ?? '';
      if (remoteCalId) {
        await deleteEvent(existing.googleAccountId, remoteCalId, existing.googleEventId, {
          sendUpdates: 'all',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { event: 'booking.google_delete_failed', bookingId, err: msg },
        'Google deleteEvent failed during cancel; booking is locally cancelled',
      );
      // Mark the row so the admin sees the warning.
      await db.booking.update({
        where: { id: bookingId },
        data: { needsSync: true, syncError: `cancel: ${msg.slice(0, 480)}` },
      });
    }
  }

  invalidateSlotCache(existing.eventTypeId);

  // Emit webhook event (best-effort, fire and forget).
  const eventType = await db.eventType.findUnique({ where: { id: existing.eventTypeId } });
  if (eventType) {
    void emit(eventType.userId, 'booking.cancelled', {
      bookingId: bookingId,
      bookerName: existing.bookerName,
      bookerEmail: existing.bookerEmail,
      startAt: existing.startAt.toISOString(),
      reason: reason ?? null,
    });
  }

  return { booking: updated, alreadyCancelled: false };
}
