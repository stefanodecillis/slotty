/**
 * Disconnect a Google account. We keep the row (with status=disconnected)
 * because bookings + EventTypes may reference it; hard-delete would cascade.
 *
 *   1. Stop watch channels for every calendar on the account.
 *   2. Best-effort revoke the refresh token at Google.
 *   3. Mark `status = 'disconnected'`.
 *   4. Archive any EventType rows that use this account as destination.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { revokeRefreshToken } from '@/lib/google/client';
import { stopWatchForCalendar } from '@/lib/sync/watch';
import { archiveEventTypesForAccount } from '@/lib/eventtype/service';
import { readJsonOrForm } from '@/lib/http/body';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest): Promise<Response> {
  await requireUser();

  const body = (await readJsonOrForm(req)) ?? {};
  const accountId = typeof body.accountId === 'string' ? body.accountId : '';
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }

  const account = await db.connectedAccount.findUnique({
    where: { id: accountId },
    include: { calendars: { select: { id: true } } },
  });
  if (!account) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  for (const cal of account.calendars) {
    try {
      await stopWatchForCalendar(cal.id);
    } catch (err) {
      logger.warn(
        { event: 'disconnect.stop_watch_failed', calendarId: cal.id },
        'stop watch failed',
      );
    }
  }

  await revokeRefreshToken(accountId).catch(() => {
    /* swallowed inside helper */
  });

  await db.connectedAccount.update({
    where: { id: accountId },
    data: { status: 'disconnected' },
  });

  // Archive any EventType rows that use this account as destination.
  await archiveEventTypesForAccount(accountId).catch((err: unknown) => {
    logger.error(
      { event: 'disconnect.archive_event_types_failed', accountId, err },
      'failed to archive event types for disconnected account',
    );
  });

  logger.info({ event: 'oauth.disconnect', accountId }, 'account disconnected');

  return NextResponse.redirect(new URL('/admin/calendars', env.SLOTTY_PUBLIC_URL), { status: 303 });
}

export const POST = csrf(handler);
