/**
 * Disconnect a Google account. We keep the row (with status=disconnected)
 * because bookings + EventTypes may reference it; hard-delete would cascade.
 *
 *   1. Stop watch channels for every calendar on the account.
 *   2. Best-effort revoke the refresh token at Google.
 *   3. Mark `status = 'disconnected'`.
 *   4. EventType cleanup is deferred to Phase 5 (model doesn't exist yet).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { revokeRefreshToken } from '@/lib/google/client';
import { stopWatchForCalendar } from '@/lib/sync/watch';

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest): Promise<Response> {
  await requireUser();

  let body: { accountId?: string };
  try {
    body = await req.json();
  } catch {
    body = Object.fromEntries(new URLSearchParams(await req.text())) as { accountId?: string };
  }

  const accountId = body?.accountId;
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

  // Phase 5 will mark dependent EventTypes as needing reconfiguration.
  // No-op until that model exists.

  logger.info({ event: 'oauth.disconnect', accountId }, 'account disconnected');

  return NextResponse.redirect(new URL('/admin/calendars', req.url), { status: 303 });
}

export const POST = csrf(handler);
