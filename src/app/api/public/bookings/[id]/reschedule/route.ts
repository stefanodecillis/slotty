/**
 * POST /api/public/bookings/[id]/reschedule?t=<token>
 *
 * Booker-initiated reschedule. Requires the reschedule token specifically
 * (the cancel token, which is more restricted in spirit, is rejected here).
 * The body just supplies the new `startAt`; everything else carries over.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';
import { verifyBookingToken } from '@/lib/booking/tokens';
import {
  rescheduleBooking,
  BookingAlreadyCancelledError,
  BookingNotFoundError,
  SlotUnavailableError,
} from '@/lib/booking/reschedule';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { capacity: 10, windowMs: 60_000 };

const bodySchema = z.object({
  startAt: z.string().min(1),
});

interface RouteParams {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-booking-reschedule', ip, RATE_LIMIT);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Too many reschedule attempts.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) } },
    );
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const booking = await db.booking.findUnique({ where: { id: params.id } });
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const tokenKind = verifyBookingToken(booking, token);
  if (tokenKind !== 'reschedule') {
    logger.warn(
      { event: 'booking.reschedule.bad_token', bookingId: booking.id },
      'reschedule attempt with invalid token',
    );
    return NextResponse.json({ error: 'Invalid or missing reschedule token' }, { status: 401 });
  }

  try {
    const result = await rescheduleBooking({
      bookingId: booking.id,
      newStartAtIso: parsed.data.startAt,
      actor: 'booker',
    });
    return NextResponse.json({
      id: result.booking.id,
      status: result.booking.status,
      startAt: result.booking.startAt,
      endAt: result.booking.endAt,
      meetingUrl: result.booking.meetingUrl,
    });
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (err instanceof BookingAlreadyCancelledError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof SlotUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    logger.error(
      {
        event: 'booking.reschedule.failed',
        bookingId: booking.id,
        err: err instanceof Error ? err.message : String(err),
      },
      'reschedule failed',
    );
    return NextResponse.json({ error: 'Reschedule failed' }, { status: 500 });
  }
}
