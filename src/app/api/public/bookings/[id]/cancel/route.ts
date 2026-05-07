/**
 * POST /api/public/bookings/[id]/cancel?t=<token>
 *
 * Booker-initiated cancel. The token is required and may be either the
 * cancel token or the reschedule token (a booker who can reschedule can
 * obviously also cancel).
 *
 * Idempotent: if the booking is already cancelled we return 200 with a flag.
 *
 * Rate limited at 10 requests/min/IP — same bucket spirit as create, scoped
 * separately so a hostile actor can't burn through booking slots and lockouts
 * at the same time.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';
import { cancelBooking, BookingNotFoundError } from '@/lib/booking/cancel';
import { verifyBookingToken } from '@/lib/booking/tokens';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { capacity: 10, windowMs: 60_000 };

const bodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

interface RouteParams {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-booking-cancel', ip, RATE_LIMIT);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Too many cancel attempts.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) } },
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';

  let body: unknown = {};
  try {
    if (req.headers.get('content-length') !== '0') {
      body = await req.json();
    }
  } catch {
    // ignore — empty body is allowed
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error' }, { status: 422 });
  }

  const booking = await db.booking.findUnique({ where: { id: params.id } });
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tokenKind = verifyBookingToken(booking, token);
  if (!tokenKind) {
    logger.warn(
      { event: 'booking.cancel.bad_token', bookingId: booking.id },
      'cancel attempt with invalid token',
    );
    return NextResponse.json({ error: 'Invalid or missing token' }, { status: 401 });
  }

  try {
    const result = await cancelBooking({
      bookingId: booking.id,
      actor: 'booker',
      reason: parsed.data.reason,
    });
    return NextResponse.json({
      id: result.booking.id,
      status: result.booking.status,
      cancelledAt: result.booking.cancelledAt,
      alreadyCancelled: result.alreadyCancelled,
    });
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    logger.error(
      { event: 'booking.cancel.failed', bookingId: booking.id, err: err instanceof Error ? err.message : String(err) },
      'cancel failed',
    );
    return NextResponse.json({ error: 'Cancel failed' }, { status: 500 });
  }
}
