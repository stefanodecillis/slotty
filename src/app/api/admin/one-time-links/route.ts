/**
 * GET  /api/admin/one-time-links — invitations the admin still cares about:
 *      pending links (with their re-copyable URL) and booked meetings that
 *      haven't ended yet. See `src/lib/one-time/service.ts` for the lifecycle.
 * POST /api/admin/one-time-links — create a hidden + invite-only EventType
 *      with its single BookingInvite (and, for custom hours, a private
 *      schedule) in one transaction.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { oneTimeLinkInputSchema } from '@/lib/one-time/validator';
import { createOneTimeLink, listOneTimeLinks, OneTimeLinkError } from '@/lib/one-time/service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const links = await listOneTimeLinks(user.id);
  return NextResponse.json({ links });
}

async function postHandler(req: NextRequest): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = oneTimeLinkInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const created = await createOneTimeLink(user.id, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof OneTimeLinkError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export const POST = csrf(postHandler);
