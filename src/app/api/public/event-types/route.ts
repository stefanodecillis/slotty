import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/**
 * Default rate limit for public GETs that have no specific quota of their
 * own (slot computation has its own 60/min bucket; booking POSTs have 10/min).
 * 120/min/IP is generous enough for legitimate page-loads + prefetches but
 * still bounds scraping.
 */
const RATE_LIMIT = { capacity: 120, windowMs: 60_000 };

/**
 * GET /api/public/event-types
 *
 * Lists publicly visible event types. `hidden=true` rows are excluded (those
 * are still bookable via direct slug URL — see `[slug]/route.ts` — but they
 * don't appear on the index). `archived=true` rows are excluded entirely
 * regardless of access path.
 *
 * No authentication required. Cache headers allow short edge caching.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-event-types-list', ip, RATE_LIMIT);
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

  const types = await db.eventType.findMany({
    where: { archived: false, hidden: false, isOneTime: false },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      durationMinutes: true,
      color: true,
      descriptionMd: true,
    },
  });

  return NextResponse.json(
    { eventTypes: types },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      },
    },
  );
}
