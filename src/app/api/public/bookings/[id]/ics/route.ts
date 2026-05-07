/**
 * GET /api/public/bookings/[id]/ics?t=<token>
 *
 * Returns the booking as an RFC 5545 calendar attachment. The token
 * (cancel or reschedule) is required so the URL isn't enumerable — booking
 * IDs are cuids but we still want defense-in-depth on attendee names / email.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { generateIcs } from '@/lib/ics';
import { verifyBookingToken } from '@/lib/booking/tokens';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'booking';
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';

  const booking = await db.booking.findUnique({
    where: { id: params.id },
    include: { eventType: { select: { title: true } }, googleAccount: { select: { googleUserEmail: true } } },
  });
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!verifyBookingToken(booking, token)) {
    return NextResponse.json({ error: 'Invalid or missing token' }, { status: 401 });
  }

  let additionalGuests: string[] = [];
  try {
    additionalGuests = JSON.parse(booking.additionalGuestsJson) as string[];
    if (!Array.isArray(additionalGuests)) additionalGuests = [];
  } catch {
    additionalGuests = [];
  }

  const ics = generateIcs({
    uid: booking.id,
    summary: booking.eventType.title,
    description: booking.notes ?? undefined,
    start: booking.startAt,
    end: booking.endAt,
    location: booking.meetingUrl ?? undefined,
    organizer: { email: booking.googleAccount.googleUserEmail },
    attendees: [
      { email: booking.bookerEmail, name: booking.bookerName, partstat: 'ACCEPTED' },
      ...additionalGuests.map((email) => ({ email })),
    ],
    sequence: 0,
    status: booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    method: booking.status === 'cancelled' ? 'CANCEL' : 'REQUEST',
  });

  const filenameBase = safeFilename(`${booking.eventType.title}-${booking.startAt.toISOString().slice(0, 10)}`);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
