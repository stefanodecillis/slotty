/**
 * GET /api/admin/bookings/[id] — owner-only booking detail.
 * Verifies the booking's event type belongs to the requesting user.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await requireUser();

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    include: {
      eventType: { select: { id: true, title: true, slug: true, userId: true, durationMinutes: true } },
      googleAccount: { select: { id: true, googleUserEmail: true } },
      history: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!booking || booking.eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    booking: {
      id: booking.id,
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: booking.status,
      bookerName: booking.bookerName,
      bookerEmail: booking.bookerEmail,
      bookerTimezone: booking.bookerTimezone,
      additionalGuests: safeJsonArray(booking.additionalGuestsJson),
      notes: booking.notes,
      answers: safeJsonObject(booking.answersJson),
      meetingUrl: booking.meetingUrl,
      googleEventId: booking.googleEventId,
      googleAccountEmail: booking.googleAccount.googleUserEmail,
      noShow: booking.noShow,
      needsSync: booking.needsSync,
      syncError: booking.syncError,
      createdAt: booking.createdAt,
      cancelledAt: booking.cancelledAt,
      cancelReason: booking.cancelReason,
      eventType: booking.eventType,
      history: booking.history.map((h) => ({
        id: h.id,
        action: h.action,
        actor: h.actor,
        createdAt: h.createdAt,
        payload: safeJsonObject(h.payloadJson),
      })),
    },
  });
}

function safeJsonObject(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
