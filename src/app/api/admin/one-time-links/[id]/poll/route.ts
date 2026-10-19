/**
 * GET /api/admin/one-time-links/[id]/poll — group poll results for a
 * one-time invitation: participants (with emails) and the best common slots.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { getPollResults, PollError } from '@/lib/group-poll/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  try {
    return NextResponse.json(await getPollResults(user.id, params.id));
  } catch (err) {
    if (err instanceof PollError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
