/**
 * DELETE /api/admin/one-time-links/[id]/poll/participants/[participantId] —
 * remove someone's answer (spam, duplicates, people who dropped out).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { PollError, removePollParticipant } from '@/lib/group-poll/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; participantId: string } };

async function deleteHandler(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  try {
    await removePollParticipant(user.id, params.id, params.participantId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PollError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export const DELETE = csrf(deleteHandler);
