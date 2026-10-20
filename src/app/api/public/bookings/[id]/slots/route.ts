/**
 * GET /api/public/bookings/[id]/slots?t=<rescheduleToken>&from=…&to=…&tz=…
 *
 * Times a booking can be moved to. Keyed by the booking and its reschedule
 * token rather than the event type's slug, so it works for invitation
 * bookings too (their slug and spent invite expose no slots), and it leaves
 * the booking itself out of the maxPerDay / maxPerWeek counts — moving the
 * day's only booking within its day must stay possible.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { computeSlots, validateSlotsWindow } from '@/lib/scheduling/compute';
import { consume } from '@/lib/ratelimit';
import { verifyBookingToken } from '@/lib/booking/tokens';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

const RATE_LIMIT = { capacity: 60, windowMs: 60_000 };

function isValidIanaTz(tz: string): boolean {
  if (!tz || tz.length > 100 || /[<>'"`]/.test(tz)) return false;
  return DateTime.now().setZone(tz).isValid;
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const decision = consume('public-booking-slots', getClientIp(req.headers), RATE_LIMIT);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)),
          'X-RateLimit-Limit': String(decision.limit),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const tz = url.searchParams.get('tz') ?? 'UTC';
  if (!fromParam || !toParam) {
    return NextResponse.json({ error: 'Missing required query params: from, to' }, { status: 400 });
  }
  if (!isValidIanaTz(tz)) {
    return NextResponse.json({ error: 'Invalid IANA timezone' }, { status: 400 });
  }
  const fromMs = Date.parse(fromParam);
  const toMs = Date.parse(toParam);
  const windowCheck = validateSlotsWindow(fromMs, toMs);
  if (!windowCheck.ok) {
    return NextResponse.json(
      { error: `Invalid date range: ${windowCheck.reason}` },
      { status: 400 },
    );
  }

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    include: { eventType: { include: { user: true } } },
  });
  // Same answer for a missing booking and a wrong token.
  if (!booking || verifyBookingToken(booking, url.searchParams.get('t') ?? '') !== 'reschedule') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (booking.status === 'cancelled' || booking.eventType.archived) {
    return NextResponse.json({ error: 'This booking can no longer be moved.' }, { status: 409 });
  }

  const { user, ...eventType } = booking.eventType;
  const result = await computeSlots({
    eventType,
    user,
    from: new Date(fromMs),
    to: new Date(toMs),
    bookerTz: tz,
    excludeBookingId: booking.id,
  });

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'private, no-store',
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': String(decision.remaining),
    },
  });
}
