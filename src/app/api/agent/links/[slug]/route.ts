/**
 * GET /api/agent/links/[slug]?tz=…&from=…&format=json|markdown
 *
 * The AI-assistant view of the booking page `/<slug>`: what the meeting is,
 * the next bookable times, and the exact HTTP calls that book one. Also
 * served at `/<slug>` itself to requests that ask for JSON or Markdown (see
 * middleware). Invite-only event types 404, like their slug page.
 */
import type { NextRequest } from 'next/server';

import { describeEventTypeLink } from '@/lib/agent/descriptor';
import { serveDescriptor } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { slug: string };
}

// Same bucket as /api/public/event-types/[slug]/slots.
const RATE_LIMIT = { scope: 'public-slots', capacity: 60, windowMs: 60_000 };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  return serveDescriptor(req, RATE_LIMIT, (opts) => describeEventTypeLink(params.slug, opts));
}
