/**
 * Thin wrappers around the Google Calendar v3 API.
 *
 * `listCalendars` and `listEventsIncremental` are the read-side; the latter
 * is the heart of the sync engine. `insertEvent` / `patchEvent` /
 * `deleteEvent` are the write-side used by the Phase 7 booking flow.
 * `watchCalendar` / `stopWatch` drive push notifications.
 *
 * All write helpers retry exactly once on a 401 by re-fetching the authed
 * client (`getAuthedClient` will trigger a token refresh automatically). They
 * return Google's response payload unchanged so callers can inspect htmlLink,
 * hangoutLink, and conferenceData entry points.
 */
import { google, calendar_v3 } from 'googleapis';

import { getAuthedClient } from './client';
import { logger } from '@/lib/logger';

export interface GCalendar {
  id: string;
  summary: string;
  description?: string;
  primary: boolean;
  timeZone?: string;
  backgroundColor?: string;
}

export type GEvent = calendar_v3.Schema$Event;

export interface IncrementalListResult {
  events: GEvent[];
  nextSyncToken: string | null;
  fullResyncRequired: boolean;
}

function calendarApi(client: Awaited<ReturnType<typeof getAuthedClient>>) {
  return google.calendar({ version: 'v3', auth: client });
}

/**
 * Run the supplied API call. On a 401 we re-fetch the authed client (which
 * triggers a token refresh) and retry once before propagating.
 */
async function withAuthRetry<T>(
  accountId: string,
  fn: (cal: ReturnType<typeof calendarApi>) => Promise<T>,
): Promise<T> {
  const client = await getAuthedClient(accountId);
  try {
    return await fn(calendarApi(client));
  } catch (err) {
    const status =
      (err as { code?: number; response?: { status?: number } })?.response?.status ??
      (err as { code?: number }).code;
    if (status === 401) {
      logger.warn(
        { event: 'google.write.retry_after_401', accountId },
        'got 401 on Google write call, refreshing token and retrying once',
      );
      const fresh = await getAuthedClient(accountId);
      return await fn(calendarApi(fresh));
    }
    throw err;
  }
}

export async function listCalendars(accountId: string): Promise<GCalendar[]> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);

  const out: GCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const params: calendar_v3.Params$Resource$Calendarlist$List = {
      maxResults: 250,
    };
    if (pageToken) params.pageToken = pageToken;
    const { data } = await cal.calendarList.list(params);
    for (const item of data.items ?? []) {
      if (!item.id || !item.summary) continue;
      out.push({
        id: item.id,
        summary: item.summary,
        description: item.description ?? undefined,
        primary: Boolean(item.primary),
        timeZone: item.timeZone ?? undefined,
        backgroundColor: item.backgroundColor ?? undefined,
      });
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

/**
 * Fetch events incrementally. On first call, omit `syncToken` to get a full
 * snapshot. On subsequent calls, pass the previous `nextSyncToken` and Google
 * returns only events that changed since the last call.
 *
 * If Google returns 410 Gone, the syncToken expired (typically after ~7
 * days of inactivity); the caller must wipe local state and start over.
 */
export async function listEventsIncremental(
  accountId: string,
  calendarId: string,
  syncToken: string | undefined,
): Promise<IncrementalListResult> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);

  const events: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  try {
    do {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId,
        // singleEvents=true so recurring events are expanded into instances.
        singleEvents: true,
        showDeleted: true,
        maxResults: 250,
      };
      if (syncToken) {
        params.syncToken = syncToken;
      } else {
        // Initial sync: cap how far back we look. Slot computation only cares
        // about future events, but we want a small buffer for in-progress
        // events so they keep blocking.
        params.timeMin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      }
      if (pageToken) params.pageToken = pageToken;

      const { data } = await cal.events.list(params);
      for (const ev of data.items ?? []) {
        events.push(ev);
      }
      pageToken = data.nextPageToken ?? undefined;
      nextSyncToken = data.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    return { events, nextSyncToken, fullResyncRequired: false };
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.response?.status
      ?? (err as { code?: number }).code;
    if (status === 410) {
      logger.info(
        { event: 'google.sync.full_resync_required', accountId, calendarId },
        'Google returned 410 Gone, full resync required',
      );
      return { events: [], nextSyncToken: null, fullResyncRequired: true };
    }
    throw err;
  }
}

export interface InsertEventOpts {
  /** Google's `sendUpdates` param. Defaults to 'all' for booking flows. */
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

/**
 * Insert a new event on the destination calendar. Returns Google's response
 * including any conferenceData (e.g. Meet link) Google created server-side.
 *
 * Pass `event.conferenceData.createRequest` to request a Meet link; we
 * automatically set `conferenceDataVersion: 1` in that case so Google honours
 * the request.
 */
export async function insertEvent(
  accountId: string,
  calendarId: string,
  event: calendar_v3.Schema$Event,
  opts: InsertEventOpts = {},
): Promise<calendar_v3.Schema$Event> {
  return withAuthRetry(accountId, async (cal) => {
    const params: calendar_v3.Params$Resource$Events$Insert = {
      calendarId,
      requestBody: event,
      sendUpdates: opts.sendUpdates ?? 'all',
    };
    if (event.conferenceData?.createRequest) {
      params.conferenceDataVersion = 1;
    }
    const { data } = await cal.events.insert(params);
    return data;
  });
}

export interface PatchEventOpts {
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

/**
 * Patch an existing event. We deliberately accept only the partial payload
 * the caller provides; Phase 7 reschedule omits `conferenceData` so the
 * existing Meet link is preserved.
 */
export async function patchEvent(
  accountId: string,
  calendarId: string,
  eventId: string,
  patch: calendar_v3.Schema$Event,
  opts: PatchEventOpts = {},
): Promise<calendar_v3.Schema$Event> {
  return withAuthRetry(accountId, async (cal) => {
    const { data } = await cal.events.patch({
      calendarId,
      eventId,
      requestBody: patch,
      sendUpdates: opts.sendUpdates ?? 'all',
    });
    return data;
  });
}

export interface DeleteEventOpts {
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

/**
 * Delete a Google event. With `sendUpdates: 'all'` (the default) Google emails
 * cancellation notices to every attendee — this is how Slotty avoids running
 * its own SMTP for cancellations.
 *
 * 404 / 410 are swallowed: if the event is already gone, the booking-side
 * cancel still succeeds.
 */
export async function deleteEvent(
  accountId: string,
  calendarId: string,
  eventId: string,
  opts: DeleteEventOpts = {},
): Promise<void> {
  try {
    await withAuthRetry(accountId, async (cal) => {
      await cal.events.delete({
        calendarId,
        eventId,
        sendUpdates: opts.sendUpdates ?? 'all',
      });
    });
  } catch (err) {
    const status =
      (err as { code?: number; response?: { status?: number } })?.response?.status ??
      (err as { code?: number }).code;
    if (status === 404 || status === 410) {
      logger.info(
        { event: 'google.delete.already_gone', accountId, calendarId, eventId, status },
        'Google event already deleted, treating as success',
      );
      return;
    }
    throw err;
  }
}

/**
 * Extract a video conference URL from a Google insertEvent / patchEvent
 * response. We look at `hangoutLink` first (the convenient top-level field
 * Google sets for Meet), then fall back to scanning `conferenceData.entryPoints`
 * for an entry of type `video`. Returns null if no conference link is present.
 */
export function extractMeetingUrl(
  event: calendar_v3.Schema$Event | null | undefined,
): string | null {
  if (!event) return null;
  if (event.hangoutLink) return event.hangoutLink;
  const entryPoints = event.conferenceData?.entryPoints ?? [];
  for (const ep of entryPoints) {
    if (ep.entryPointType === 'video' && ep.uri) return ep.uri;
  }
  return null;
}

export interface WatchResult {
  channelId: string;
  resourceId: string;
  expiration: number;
}

/**
 * Subscribe to push notifications for a calendar. Google posts to `address`
 * whenever an event in this calendar changes. We pass `token` so the receiver
 * can verify the request is genuinely from Google (HMAC of calendarId).
 */
export async function watchCalendar(
  accountId: string,
  calendarId: string,
  channelId: string,
  address: string,
  token: string,
  expirationMs: number,
): Promise<WatchResult> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);

  const { data } = await cal.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address,
      token,
      expiration: String(expirationMs),
    },
  });
  if (!data.id || !data.resourceId) {
    throw new Error('events.watch did not return id/resourceId');
  }
  return {
    channelId: data.id,
    resourceId: data.resourceId,
    expiration: Number(data.expiration ?? expirationMs),
  };
}

export async function stopWatch(
  accountId: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);
  await cal.channels.stop({
    requestBody: {
      id: channelId,
      resourceId,
    },
  });
}
