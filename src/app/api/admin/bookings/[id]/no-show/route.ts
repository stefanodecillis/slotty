/**
 * POST /api/admin/bookings/[id]/no-show — owner-only flag toggle.
 *
 * Body: `{ noShow: boolean }`. Writes a BookingHistory entry with the
 * appropriate action (`no_show_marked` / `no_show_cleared`) so the timeline
 * tells the story. No Google interaction.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { emit } from '@/lib/webhooks/emit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  noShow: z.boolean(),
});

interface RouteParams {
  params: { id: string };
}

async function handler(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error' }, { status: 422 });
  }

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    include: { eventType: { select: { userId: true } } },
  });
  if (!booking || booking.eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (booking.noShow === parsed.data.noShow) {
    return NextResponse.json({ id: booking.id, noShow: booking.noShow, unchanged: true });
  }

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.booking.update({
      where: { id: booking.id },
      data: { noShow: parsed.data.noShow },
    });
    await tx.bookingHistory.create({
      data: {
        bookingId: booking.id,
        action: parsed.data.noShow ? 'no_show_marked' : 'no_show_cleared',
        payloadJson: JSON.stringify({ before: booking.noShow, after: parsed.data.noShow }),
        actor: 'owner',
      },
    });
    return next;
  });

  if (parsed.data.noShow) {
    void emit(user.id, 'booking.no_show', {
      bookingId: booking.id,
      bookerName: booking.bookerName,
      bookerEmail: booking.bookerEmail,
      startAt: booking.startAt.toISOString(),
    });
  }

  return NextResponse.json({ id: updated.id, noShow: updated.noShow });
}

export const POST = csrf(handler);
