/**
 * POST /api/admin/bookings/[id]/cancel — owner-initiated cancel.
 * No token check; owner has implicit authority over their bookings. Same
 * underlying machinery as the public cancel.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { cancelBooking, BookingNotFoundError } from '@/lib/booking/cancel';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

interface RouteParams {
  params: { id: string };
}

async function handler(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await requireUser();

  let body: unknown = {};
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json();
  } catch {
    // empty body OK
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error' }, { status: 422 });
  }

  // Ownership check.
  const booking = await db.booking.findUnique({
    where: { id: params.id },
    include: { eventType: { select: { userId: true } } },
  });
  if (!booking || booking.eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const result = await cancelBooking({
      bookingId: booking.id,
      actor: 'owner',
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
      { event: 'admin.booking.cancel.failed', bookingId: booking.id, err: err instanceof Error ? err.message : String(err) },
      'admin cancel failed',
    );
    return NextResponse.json({ error: 'Cancel failed' }, { status: 500 });
  }
}

export const POST = csrf(handler);
