/**
 * POST /api/admin/one-time-links/[id]/poll/finalize { startUtc } — book the
 * chosen slot for everyone who answered. Goes through the regular booking
 * pipeline (slot re-check, Google event, Meet link, invite consumption).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { finalizePoll, PollError } from '@/lib/group-poll/service';
import { finalizePollSchema } from '@/lib/group-poll/validator';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

async function postHandler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = finalizePollSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    return NextResponse.json(await finalizePoll(user.id, params.id, parsed.data.startUtc));
  } catch (err) {
    if (err instanceof PollError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export const POST = csrf(postHandler);
