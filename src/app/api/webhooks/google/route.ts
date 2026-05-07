/**
 * Webhook receiver for Google's `events.watch` push notifications.
 *
 * Headers Google sends (relevant subset):
 *   X-Goog-Channel-Id      — uuid we picked at watch creation
 *   X-Goog-Resource-Id     — server-assigned id (we save it for stop())
 *   X-Goog-Resource-State  — "sync" (handshake) | "exists" | "not_exists"
 *   X-Goog-Channel-Token   — the HMAC token we passed to events.watch
 *
 * We HMAC-verify the token against `hmac(SLOTTY_SESSION_SECRET, calendarId)`
 * — that's what `setupWatchChannel` registered. If it doesn't match → 401.
 *
 * We never block on the actual sync: we just enqueue an `incremental_sync`
 * job and return 200 within a few ms. Google retries with exponential
 * backoff on any non-2xx response, so it's important to return fast.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { safeEqual } from '@/lib/crypto';
import { enqueueJob } from '@/lib/jobs/scheduler';
import { watchTokenFor } from '@/lib/sync/watch';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const channelId = req.headers.get('x-goog-channel-id');
  const resourceState = req.headers.get('x-goog-resource-state');
  const token = req.headers.get('x-goog-channel-token');

  if (!channelId) {
    return new NextResponse(null, { status: 400 });
  }

  const calendar = await db.calendar.findFirst({
    where: { watchChannelId: channelId },
    select: { id: true },
  });

  if (!calendar) {
    // Unknown channel — quietly 200 so Google stops retrying. (We may have
    // forgotten to call channels.stop and the channel kept firing.)
    logger.warn(
      { event: 'webhook.google.unknown_channel', channelId },
      'unknown Google channel, ignoring',
    );
    return new NextResponse(null, { status: 200 });
  }

  const expectedToken = watchTokenFor(calendar.id);
  if (!token || !safeEqual(token, expectedToken)) {
    logger.warn(
      { event: 'webhook.google.bad_token', channelId, calendarId: calendar.id },
      'channel token mismatch',
    );
    return new NextResponse(null, { status: 401 });
  }

  // Initial handshake; nothing to sync yet.
  if (resourceState === 'sync') {
    logger.info(
      { event: 'webhook.google.sync_handshake', calendarId: calendar.id },
      'received sync handshake',
    );
    return new NextResponse(null, { status: 200 });
  }

  // Fire-and-forget enqueue. We MUST return 200 fast so Google doesn't retry.
  void enqueueJob('incremental_sync', { calendarId: calendar.id }).catch((err) => {
    logger.error(
      { event: 'webhook.google.enqueue_failed', calendarId: calendar.id, err: String(err) },
      'failed to enqueue incremental_sync from webhook',
    );
  });

  return new NextResponse(null, { status: 200 });
}
