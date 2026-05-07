import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

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
export async function GET(): Promise<Response> {
  const types = await db.eventType.findMany({
    where: { archived: false, hidden: false },
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
