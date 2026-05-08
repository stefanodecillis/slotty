/**
 * Incremental sync from Google Calendar into our local `BusyEvent` table.
 *
 * Algorithm:
 *   1. Look up `Calendar.syncToken`. Null on first sync.
 *   2. Call `events.list({ syncToken })`.
 *   3. On 410 Gone: clear `syncToken`, delete all `BusyEvent` rows for this
 *      calendar, then recursively call self to perform a full pull.
 *   4. For each returned event:
 *      - cancelled  → delete the matching BusyEvent. If the cancelled event
 *        corresponds to a confirmed slotty Booking (matched by googleEventId),
 *        also mark that Booking cancelled with reason "Deleted in Google
 *        Calendar". DB-only — no email, no webhook (Google's own delete with
 *        sendUpdates=all already notified attendees).
 *      - transparent (free) → delete (these don't block)
 *      - opaque, confirmed/tentative → upsert with start/end + status
 *   5. Save `nextSyncToken` and `lastIncrementalSyncAt`.
 *
 * One automatic 401 retry: if Google returns 401 we refresh the token and
 * try again before giving up.
 */
import type { calendar_v3 } from 'googleapis';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { listEventsIncremental } from '@/lib/google/calendar';
import { markAccountNeedsReauth } from '@/lib/google/client';
import { invalidate as invalidateSlotCache } from '@/lib/scheduling/cache';

interface ParsedTime {
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
}

function parseEventTime(event: calendar_v3.Schema$Event): ParsedTime | null {
  // Timed event.
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      startAt: new Date(event.start.dateTime),
      endAt: new Date(event.end.dateTime),
      isAllDay: false,
    };
  }
  // All-day event uses `date` (YYYY-MM-DD). Google's convention is that the
  // end date is exclusive (the day after). We normalise to UTC midnight to
  // midnight; the slot algorithm in Phase 6 will respect timezone.
  if (event.start?.date && event.end?.date) {
    return {
      startAt: new Date(`${event.start.date}T00:00:00Z`),
      endAt: new Date(`${event.end.date}T00:00:00Z`),
      isAllDay: true,
    };
  }
  return null;
}

// Mirror an upstream Google deletion onto any matching slotty Booking. The
// owner deleted the event from their calendar UI, so we cancel the booking
// locally to keep the admin view consistent. Idempotent: if the booking is
// already cancelled (e.g. because the cancellation originated *from* slotty
// and is now echoing back via the webhook), this is a no-op.
async function cancelBookingFromUpstreamDeletion(
  calendarId: string,
  googleEventId: string,
): Promise<void> {
  const booking = await db.booking.findFirst({
    where: { googleCalendarId: calendarId, googleEventId, status: 'confirmed' },
  });
  if (!booking) return;

  const now = new Date();
  await db.$transaction([
    db.booking.update({
      where: { id: booking.id },
      data: {
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: 'Deleted in Google Calendar',
      },
    }),
    db.bookingHistory.create({
      data: {
        bookingId: booking.id,
        action: 'cancelled',
        actor: 'system',
        payloadJson: JSON.stringify({
          previousStatus: booking.status,
          reason: 'Deleted in Google Calendar',
          cancelledAt: now.toISOString(),
          source: 'sync',
        }),
      },
    }),
  ]);

  logger.info(
    { event: 'sync.booking_cancelled_from_upstream', bookingId: booking.id, calendarId, googleEventId },
    'cancelled booking after detecting upstream Google Calendar deletion',
  );
}

async function applyEventChange(calendarId: string, event: calendar_v3.Schema$Event): Promise<void> {
  if (!event.id) return;

  // Cancelled → delete BusyEvent (so the slot reopens) and mirror the cancel
  // onto any matching slotty Booking.
  if (event.status === 'cancelled') {
    await cancelBookingFromUpstreamDeletion(calendarId, event.id);
    // deleteMany silently no-ops if the row doesn't exist (no error log noise).
    await db.busyEvent.deleteMany({ where: { calendarId, googleEventId: event.id } });
    return;
  }

  // Transparent ("show me as available") → don't block our slots.
  if (event.transparency === 'transparent') {
    // deleteMany silently no-ops if the row doesn't exist (no error log noise).
    await db.busyEvent.deleteMany({ where: { calendarId, googleEventId: event.id } });
    return;
  }

  const time = parseEventTime(event);
  if (!time) {
    // Malformed / partial event — skip but log.
    logger.debug(
      { event: 'sync.skip_malformed_event', calendarId, eventId: event.id },
      'event missing start/end times, skipping',
    );
    return;
  }

  await db.busyEvent.upsert({
    where: {
      calendarId_googleEventId: { calendarId, googleEventId: event.id },
    },
    create: {
      calendarId,
      googleEventId: event.id,
      startAt: time.startAt,
      endAt: time.endAt,
      status: event.status ?? 'confirmed',
      isAllDay: time.isAllDay,
      transparency: event.transparency ?? 'opaque',
      recurringEventId: event.recurringEventId ?? null,
    },
    update: {
      startAt: time.startAt,
      endAt: time.endAt,
      status: event.status ?? 'confirmed',
      isAllDay: time.isAllDay,
      transparency: event.transparency ?? 'opaque',
      recurringEventId: event.recurringEventId ?? null,
    },
  });
}

/**
 * Sync one calendar incrementally. Updates BusyEvent rows in-place.
 * Throws on terminal errors; transient errors are retried once on 401.
 */
export async function syncCalendarIncremental(calendarId: string): Promise<void> {
  const calendar = await db.calendar.findUnique({
    where: { id: calendarId },
    include: { connectedAccount: true },
  });
  if (!calendar) throw new Error(`Calendar not found: ${calendarId}`);
  if (calendar.connectedAccount.status !== 'active') {
    logger.debug(
      { event: 'sync.skip_inactive', calendarId, status: calendar.connectedAccount.status },
      'skipping inactive account',
    );
    return;
  }

  const accountId = calendar.connectedAccountId;
  const googleCalendarId = calendar.googleCalendarId;

  const result = await runWithRetryOn401(() =>
    listEventsIncremental(accountId, googleCalendarId, calendar.syncToken ?? undefined),
  );

  if (result.fullResyncRequired) {
    logger.info(
      { event: 'sync.full_resync_start', calendarId },
      'syncToken expired, performing full resync',
    );
    await db.$transaction([
      db.busyEvent.deleteMany({ where: { calendarId } }),
      db.calendar.update({ where: { id: calendarId }, data: { syncToken: null } }),
    ]);
    // Recurse — second call has no syncToken so it'll fetch the full snapshot.
    await syncCalendarIncremental(calendarId);
    return;
  }

  for (const event of result.events) {
    await applyEventChange(calendarId, event);
  }

  await db.calendar.update({
    where: { id: calendarId },
    data: {
      syncToken: result.nextSyncToken,
      lastIncrementalSyncAt: new Date(),
    },
  });

  await db.connectedAccount.update({
    where: { id: accountId },
    data: { lastSyncedAt: new Date(), lastSyncError: null },
  });

  // After a sync the busy table may have changed for any number of event
  // types, so we drop the entire slot cache rather than enumerate IDs. The
  // cache also folds in BusyEvent.updatedAt as part of its key, so this is
  // a defensive belt-and-braces; we drop it explicitly here so callers that
  // share the same process see fresh slots immediately.
  invalidateSlotCache();

  logger.info(
    {
      event: 'sync.completed',
      calendarId,
      eventsProcessed: result.events.length,
      hasNextSyncToken: Boolean(result.nextSyncToken),
    },
    'incremental sync completed',
  );
}

async function runWithRetryOn401<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.response?.status
      ?? (err as { code?: number }).code;
    if (status === 401) {
      logger.warn({ event: 'sync.retry_after_401' }, 'got 401 from Google, retrying once');
      // The OAuth2Client refreshes on demand; one retry is enough. If the
      // refresh itself fails, getAuthedClient will mark the account
      // needs_reauth and re-throw.
      return await fn();
    }
    if (status === 403 && (err as { errors?: Array<{ reason?: string }> }).errors?.[0]?.reason === 'rateLimitExceeded') {
      throw err;
    }
    if (status === 401 || status === 403) {
      // Likely revoked.
      throw err;
    }
    throw err;
  }
}

// Re-export for convenience.
export { markAccountNeedsReauth };
