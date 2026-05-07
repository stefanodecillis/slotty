/**
 * Incremental sync from Google Calendar into our local `BusyEvent` table.
 *
 * Algorithm:
 *   1. Look up `Calendar.syncToken`. Null on first sync.
 *   2. Call `events.list({ syncToken })`.
 *   3. On 410 Gone: clear `syncToken`, delete all `BusyEvent` rows for this
 *      calendar, then recursively call self to perform a full pull.
 *   4. For each returned event:
 *      - cancelled  → delete the matching BusyEvent
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

async function applyEventChange(calendarId: string, event: calendar_v3.Schema$Event): Promise<void> {
  if (!event.id) return;

  // Cancelled → delete (so the slot reopens).
  if (event.status === 'cancelled') {
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
