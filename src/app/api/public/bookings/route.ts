import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/public/bookings — Phase 7 will implement this.
 *
 * For Phase 6 we register the route so the booking flow has a target to POST
 * to and gets a clean error rather than a Next 404.
 */
export async function POST(): Promise<Response> {
  return NextResponse.json(
    { error: 'Bookings will be implemented in Phase 7.' },
    { status: 503 },
  );
}
