import { NextResponse, type NextRequest } from 'next/server';
import { DateTime } from 'luxon';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { requireUser } from '@/lib/auth/session';
import { validateOrigin } from '@/lib/auth/csrf';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/profile/timezone
 *
 * One-shot autodetect: callable from the admin layout on first load when the
 * owner's `timezoneSet` flag is still false. Body is `{ timezone }` (an IANA
 * zone supplied by the browser via Intl.DateTimeFormat). The endpoint is a
 * no-op once `timezoneSet` is true, so a stale tab can't overwrite a tz the
 * user has since chosen explicitly. Manual edits in /admin/profile and
 * /admin/settings flip the flag separately.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!validateOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const tz = (body as { timezone?: unknown })?.timezone;
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }
  if (!DateTime.now().setZone(tz).isValid) {
    return NextResponse.json({ error: 'Unknown timezone' }, { status: 400 });
  }

  const current = await db.user.findUnique({
    where: { id: user.id },
    select: { timezoneSet: true },
  });
  if (current?.timezoneSet) {
    return NextResponse.json({ ok: true, locked: true }, { status: 200 });
  }

  // Propagate to schedules so weekly hours are interpreted in the owner's
  // local time (single-user MVP — schedules don't have an independent UI for
  // tz, so they should track the user's setting).
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { timezone: tz, timezoneSet: true },
    }),
    db.schedule.updateMany({
      where: { userId: user.id },
      data: { timezone: tz },
    }),
  ]);

  // Bookings now span a different wall-clock window relative to the schedule —
  // drop the slot cache so the next read recomputes against the new tz.
  const { invalidate } = await import('@/lib/scheduling/cache');
  invalidate();

  logger.info({ event: 'profile.timezone_autodetected', userId: user.id, tz }, 'timezone autodetected');
  return NextResponse.json({ ok: true, timezone: tz }, { status: 200 });
}
