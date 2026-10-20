/**
 * GET /api/agent/invites/[token]?tz=…&from=…&format=json|markdown
 *
 * The AI-assistant view of `/i/<token>`: a single-use invitation (book it)
 * or a group poll (answer it with the user's availability). Closed links
 * report why and nothing else. Also served at `/i/<token>` itself to
 * requests that ask for JSON or Markdown (see middleware).
 */
import type { NextRequest } from 'next/server';

import { describeInviteLink } from '@/lib/agent/descriptor';
import { serveDescriptor } from '@/lib/agent/http';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { token: string };
}

// Same bucket as /api/public/invites/[token]/slots.
const RATE_LIMIT = { scope: 'public-invite-slots', capacity: 60, windowMs: 60_000 };

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  return serveDescriptor(req, RATE_LIMIT, (opts) => describeInviteLink(params.token, opts));
}
