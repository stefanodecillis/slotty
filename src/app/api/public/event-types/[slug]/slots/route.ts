import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { computeSlots, validateSlotsWindow } from '@/lib/scheduling/compute';
import { consume } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { slug: string };
}

const RATE_LIMIT = { capacity: 60, windowMs: 60_000 };

function isValidIanaTz(tz: string): boolean {
  if (!tz || /[<>'"`]/.test(tz)) return false;
  try {
    const dt = DateTime.now().setZone(tz);
    return dt.isValid;
  } catch {
    return false;
  }
}

/**
 * GET /api/public/event-types/[slug]/slots?from=...&to=...&tz=...
 *
 * Returns bookable slots for the given window. Per-IP rate limit of 60 RPM
 * to deter scraping. Inputs are validated strictly: malformed dates, bad
 * timezones, inverted ranges, or windows greater than 90 days yield 400.
 */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-slots', ip, RATE_LIMIT);
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

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const tz = url.searchParams.get('tz') ?? 'UTC';

  if (!fromParam || !toParam) {
    return NextResponse.json(
      { error: 'Missing required query params: from, to' },
      { status: 400 },
    );
  }
  if (!isValidIanaTz(tz)) {
    return NextResponse.json({ error: 'Invalid IANA timezone' }, { status: 400 });
  }

  const fromMs = Date.parse(fromParam);
  const toMs = Date.parse(toParam);
  const windowCheck = validateSlotsWindow(fromMs, toMs);
  if (!windowCheck.ok) {
    return NextResponse.json(
      { error: `Invalid date range: ${windowCheck.reason}` },
      { status: 400 },
    );
  }

  const eventType = await db.eventType.findUnique({
    where: { slug: params.slug },
  });
  if (!eventType || eventType.archived) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const user = await db.user.findUnique({ where: { id: eventType.userId } });
  if (!user) {
    return NextResponse.json({ error: 'Owner missing' }, { status: 404 });
  }

  const result = await computeSlots({
    eventType,
    user,
    from: new Date(fromMs),
    to: new Date(toMs),
    bookerTz: tz,
  });

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'private, max-age=15',
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': String(decision.remaining),
    },
  });
}
