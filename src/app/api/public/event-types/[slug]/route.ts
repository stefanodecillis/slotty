import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { slug: string };
}

/** Default per-IP quota for public GETs. */
const RATE_LIMIT = { capacity: 120, windowMs: 60_000 };

/**
 * GET /api/public/event-types/[slug]
 *
 * Returns a single event type's public-facing fields. Excludes anything
 * sensitive (passwordHash, owner credentials). Hidden types are still
 * returned via direct slug — that's the "private link" use case.
 *
 * Archived types and missing slugs return 404.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-event-type-get', ip, RATE_LIMIT);
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

  const { slug } = params;

  const eventType = await db.eventType.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      descriptionMd: true,
      color: true,
      durationMinutes: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
      minNoticeMin: true,
      bookingWindowDays: true,
      slotIntervalMin: true,
      maxPerDay: true,
      maxPerWeek: true,
      locationKind: true,
      // Note: locationValue is intentionally excluded for non-custom-link
      // location kinds, since e.g. the owner's phone number is sensitive.
      // We expose it for the "custom_link" kind only because the booker needs
      // to know where to go in advance.
      locationValue: true,
      archived: true,
      hidden: true,
      passwordHash: true,
      questions: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          label: true,
          helperText: true,
          kind: true,
          required: true,
          optionsJson: true,
          position: true,
        },
      },
    },
  });

  if (!eventType || eventType.archived) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Decide whether this event type requires a password. The hash itself never
  // leaves the server.
  const requiresPassword = Boolean(eventType.passwordHash);
  const safeLocationValue =
    eventType.locationKind === 'custom_link' ? eventType.locationValue : null;

  const { passwordHash: _passwordHash, ...rest } = eventType;
  void _passwordHash;

  return NextResponse.json({
    eventType: {
      ...rest,
      locationValue: safeLocationValue,
      requiresPassword,
    },
  });
}
