/**
 * Push notifications via Google's `events.watch` channels.
 *
 * Each Calendar gets one channel; Google posts to
 * `${SLOTTY_PUBLIC_URL}/api/webhooks/google` whenever an event changes. The
 * webhook receiver schedules an `incremental_sync` job; the actual diff comes
 * from `events.list({ syncToken })`.
 *
 * Channels expire after at most 7 days (we use 6 to give ourselves a buffer).
 * `renewExpiringChannels` runs daily and renews anything within 48h of expiry.
 */
import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { hmac } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { watchCalendar, stopWatch } from '@/lib/google/calendar';

/** 6 days, in ms. Google caps watch channels at 7d. */
const CHANNEL_LIFETIME_MS = 6 * 24 * 60 * 60 * 1000;
/** Renew if expiry is closer than 48h. */
const RENEWAL_WINDOW_MS = 48 * 60 * 60 * 1000;

function webhookAddress(): string {
  const base = env.SLOTTY_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/api/webhooks/google`;
}

/**
 * Compute the HMAC token Google echoes back as `X-Goog-Channel-Token`.
 * Used both at registration and at receipt.
 */
export function watchTokenFor(calendarId: string): string {
  return hmac(env.SLOTTY_SESSION_SECRET, calendarId);
}

export async function setupWatchChannel(calendarId: string): Promise<void> {
  const calendar = await db.calendar.findUnique({
    where: { id: calendarId },
    include: { connectedAccount: true },
  });
  if (!calendar) throw new Error(`Calendar not found: ${calendarId}`);
  if (calendar.connectedAccount.status !== 'active') {
    logger.debug(
      { event: 'sync.watch.skip_inactive', calendarId },
      'skipping watch setup for inactive account',
    );
    return;
  }

  const channelId = randomUUID();
  const token = watchTokenFor(calendarId);
  const expirationMs = Date.now() + CHANNEL_LIFETIME_MS;

  try {
    const result = await watchCalendar(
      calendar.connectedAccountId,
      calendar.googleCalendarId,
      channelId,
      webhookAddress(),
      token,
      expirationMs,
    );
    await db.calendar.update({
      where: { id: calendarId },
      data: {
        watchChannelId: result.channelId,
        watchResourceId: result.resourceId,
        watchExpiresAt: new Date(result.expiration),
      },
    });
    logger.info(
      {
        event: 'sync.watch.created',
        calendarId,
        channelId: result.channelId,
        expiresAt: new Date(result.expiration).toISOString(),
      },
      'watch channel created',
    );
  } catch (err) {
    // Watch failure is non-fatal — we still have polling as a fallback.
    logger.warn(
      { event: 'sync.watch.create_failed', calendarId, err: errMessage(err) },
      'watch channel creation failed; polling will catch changes',
    );
  }
}

export async function stopWatchForCalendar(calendarId: string): Promise<void> {
  const calendar = await db.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) return;
  if (!calendar.watchChannelId || !calendar.watchResourceId) return;

  try {
    await stopWatch(
      calendar.connectedAccountId,
      calendar.watchChannelId,
      calendar.watchResourceId,
    );
  } catch (err) {
    // Non-fatal: the channel may have already expired or been revoked.
    logger.warn(
      { event: 'sync.watch.stop_failed', calendarId, err: errMessage(err) },
      'watch stop failed (already revoked?)',
    );
  } finally {
    await db.calendar.update({
      where: { id: calendarId },
      data: { watchChannelId: null, watchResourceId: null, watchExpiresAt: null },
    });
  }
}

/** Re-create channels approaching expiry. */
export async function renewExpiringChannels(): Promise<void> {
  const cutoff = new Date(Date.now() + RENEWAL_WINDOW_MS);
  const candidates = await db.calendar.findMany({
    where: {
      isBusySource: true,
      watchExpiresAt: { lt: cutoff },
      connectedAccount: { status: 'active' },
    },
  });

  for (const cal of candidates) {
    try {
      await stopWatchForCalendar(cal.id);
      await setupWatchChannel(cal.id);
    } catch (err) {
      logger.warn(
        { event: 'sync.watch.renew_failed', calendarId: cal.id, err: errMessage(err) },
        'channel renewal failed',
      );
    }
  }

  logger.info(
    { event: 'sync.watch.renew_completed', count: candidates.length },
    'watch channel renewal sweep complete',
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
