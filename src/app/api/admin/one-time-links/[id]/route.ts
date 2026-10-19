/**
 * GET    /api/admin/one-time-links/[id] — full form values + current URL.
 * PATCH  /api/admin/one-time-links/[id] — replace every field; 409 once booked.
 * DELETE /api/admin/one-time-links/[id] — delete a pending invitation; 409 if
 *        it has an upcoming meeting (cancel the meeting instead).
 *
 * `[id]` is the one-time EventType id.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { oneTimeLinkInputSchema } from '@/lib/one-time/validator';
import {
  deleteOneTimeLink,
  getOneTimeLink,
  OneTimeLinkError,
  updateOneTimeLink,
} from '@/lib/one-time/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

function errorResponse(err: unknown): Response {
  if (err instanceof OneTimeLinkError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  throw err;
}

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  try {
    return NextResponse.json(await getOneTimeLink(user.id, params.id));
  } catch (err) {
    return errorResponse(err);
  }
}

async function patchHandler(req: NextRequest, { params }: RouteContext): Promise<Response> {
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
    await updateOneTimeLink(user.id, params.id, parsed.data);
    return NextResponse.json(await getOneTimeLink(user.id, params.id));
  } catch (err) {
    return errorResponse(err);
  }
}

async function deleteHandler(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();
  try {
    await deleteOneTimeLink(user.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export const PATCH = csrf(patchHandler);
export const DELETE = csrf(deleteHandler);
