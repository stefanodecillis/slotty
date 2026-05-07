/**
 * Manual resync trigger. POST { calendarId? }; if omitted, queues incremental
 * syncs for every calendar that's a busy source on an active account.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueueJob } from '@/lib/jobs/scheduler';

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest): Promise<Response> {
  await requireUser();

  let body: { calendarId?: string };
  try {
    body = await req.json();
  } catch {
    body = Object.fromEntries(new URLSearchParams(await req.text())) as { calendarId?: string };
  }

  const ids: string[] = [];
  if (body.calendarId) {
    const cal = await db.calendar.findUnique({ where: { id: body.calendarId } });
    if (!cal) return NextResponse.json({ error: 'calendar not found' }, { status: 404 });
    ids.push(cal.id);
  } else {
    const cals = await db.calendar.findMany({
      where: {
        isBusySource: true,
        connectedAccount: { status: 'active' },
      },
      select: { id: true },
    });
    for (const c of cals) ids.push(c.id);
  }

  for (const id of ids) {
    await enqueueJob('incremental_sync', { calendarId: id });
  }

  logger.info({ event: 'oauth.resync.triggered', count: ids.length }, 'resync requested');

  return NextResponse.redirect(new URL('/admin/calendars', req.url), { status: 303 });
}

export const POST = csrf(handler);
