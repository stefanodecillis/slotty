/**
 * POST /api/public/bookings — public booking creation.
 *
 * - Rate limited at 10 requests/min/IP to deter brute force on
 *   password-protected event types and to bound abuse.
 * - Body validation via Zod; bad shape → 400.
 * - Idempotent on `clientRequestId` per event type.
 * - Slot is re-checked inside a DB transaction by `createBooking`.
 * - Google Calendar insert happens after commit. If it fails the booking is
 *   still saved with `needsSync=true` and the response is still 200 so the
 *   booker isn't blamed for an upstream outage.
 *
 * The route returns the management URL (with raw reschedule token) and the
 * meeting URL (if any). Tokens never leave the server again — the booker has
 * to keep this URL.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { createBooking, BookingError, makeManageUrl } from '@/lib/booking/create';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { capacity: 10, windowMs: 60_000 };

const bodySchema = z.object({
  eventTypeSlug: z.string().min(1).max(100),
  startAt: z.string().min(1),
  bookerName: z.string().trim().min(1).max(200),
  bookerEmail: z.string().trim().email().max(320),
  bookerTimezone: z.string().min(1).max(100),
  additionalGuests: z.array(z.string().trim().email().max(320)).max(20).optional(),
  notes: z.string().max(5000).optional(),
  answers: z.record(z.string(), z.string().max(5000)).optional(),
  clientRequestId: z.string().max(100).optional(),
  password: z.string().max(500).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-bookings', ip, RATE_LIMIT);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: 'Too many booking attempts. Please slow down.' },
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

  let body: unknown;
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

  const input = parsed.data;

  try {
    const result = await createBooking({
      eventTypeSlug: input.eventTypeSlug,
      startAtIso: input.startAt,
      bookerName: input.bookerName,
      bookerEmail: input.bookerEmail,
      bookerTimezone: input.bookerTimezone,
      additionalGuests: input.additionalGuests,
      notes: input.notes,
      answers: input.answers,
      clientRequestId: input.clientRequestId,
      password: input.password,
    });

    // On idempotent replay we don't have raw tokens to hand back. The original
    // response did. We still return enough for the client to navigate to the
    // confirmation page (without `t=` they'll see the read-only view).
    if (result.idempotentReplay) {
      const base = makeManageUrl(result.booking.id, '');
      return NextResponse.json({
        id: result.booking.id,
        status: result.booking.status,
        manageUrl: base.replace(/\?t=$/, ''),
        meetingUrl: result.booking.meetingUrl,
        idempotentReplay: true,
        needsSync: result.booking.needsSync,
      });
    }

    return NextResponse.json({
      id: result.booking.id,
      status: result.booking.status,
      manageUrl: makeManageUrl(result.booking.id, result.rawRescheduleToken),
      cancelToken: result.rawCancelToken,
      rescheduleToken: result.rawRescheduleToken,
      meetingUrl: result.booking.meetingUrl,
      needsSync: result.needsSync,
    });
  } catch (err) {
    if (err instanceof BookingError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.httpStatus },
      );
    }
    logger.error(
      {
        event: 'booking.create_failed',
        err: err instanceof Error ? err.message : String(err),
      },
      'Unexpected error in POST /api/public/bookings',
    );
    return NextResponse.json({ error: 'Booking failed' }, { status: 500 });
  }
}
