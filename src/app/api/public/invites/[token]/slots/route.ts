/**
 * GET /api/public/invites/[token]/slots?from=...&to=...&tz=...
 *
 * Slot availability for an invite-token-keyed booking flow.
 *
 * Mirrors `/api/public/event-types/[slug]/slots` but resolves the event type
 * via a one-time invite token instead of a slug. Used by BookingFlow when
 * rendered under `/i/[token]` for an invite-only event type — the slug-keyed
 * route would 404 in that case.
 *
 * The token still has to resolve to an unused, non-revoked, non-expired
 * invite. This intentionally means: once the invite is consumed, the URL
 * stops returning slots too — third parties who learned the URL from a
 * shoulder-surf can't keep polling availability.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';

import { db } from '@/lib/db';
import { getClientIp } from '@/lib/http/client-ip';
import { computeSlots, validateSlotsWindow } from '@/lib/scheduling/compute';
import { consume } from '@/lib/ratelimit';
import { resolveInviteByRawToken } from '@/lib/booking/invite';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { token: string };
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

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const ip = getClientIp(req.headers);
  const decision = consume('public-invite-slots', ip, RATE_LIMIT);
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

  const resolved = await resolveInviteByRawToken(params.token);
  if (resolved.status !== 'ok' || !resolved.eventType) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (resolved.eventType.archived) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const user = await db.user.findUnique({ where: { id: resolved.eventType.userId } });
  if (!user) {
    return NextResponse.json({ error: 'Owner missing' }, { status: 404 });
  }

  const result = await computeSlots({
    eventType: resolved.eventType,
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
