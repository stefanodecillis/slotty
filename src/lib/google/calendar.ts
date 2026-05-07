/**
 * Thin wrappers around the Google Calendar v3 API.
 *
 * `listCalendars` and `listEventsIncremental` are the read-side; the latter
 * is the heart of the sync engine. `insertEvent` / `patchEvent` /
 * `deleteEvent` will be filled in during Phase 7 when we begin writing
 * to Google. `watchCalendar` / `stopWatch` drive push notifications.
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

/**
 * Phase 7 hook — placeholder. Returns the inserted event with `htmlLink` set
 * so we can store it on the booking record.
 */
export async function insertEvent(
  accountId: string,
  calendarId: string,
  event: calendar_v3.Schema$Event,
): Promise<calendar_v3.Schema$Event> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);

  const params: calendar_v3.Params$Resource$Events$Insert = {
    calendarId,
    requestBody: event,
  };
  if (event.conferenceData?.createRequest) {
    params.conferenceDataVersion = 1;
  }
  const { data } = await cal.events.insert(params);
  return data;
}

/** Phase 7 hook — placeholder. */
export async function patchEvent(
  accountId: string,
  calendarId: string,
  eventId: string,
  patch: calendar_v3.Schema$Event,
): Promise<calendar_v3.Schema$Event> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);
  const { data } = await cal.events.patch({
    calendarId,
    eventId,
    requestBody: patch,
  });
  return data;
}

/** Phase 7 hook — placeholder. */
export async function deleteEvent(
  accountId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const auth = await getAuthedClient(accountId);
  const cal = calendarApi(auth);
  await cal.events.delete({ calendarId, eventId });
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
