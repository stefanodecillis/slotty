import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { eventTypeInputSchema } from '@/lib/eventtype/validator';
import { updateEventType, deleteEventType, ServiceError } from '@/lib/eventtype/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  const eventType = await db.eventType.findUnique({
    where: { id: params.id },
    include: {
      questions: { orderBy: { position: 'asc' } },
      destinationCalendar: { select: { name: true, isDestinationEligible: true } },
      destinationAccount: { select: { googleUserEmail: true, status: true } },
    },
  });

  if (!eventType || eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(eventType);
}

async function putHandler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = eventTypeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const updated = await updateEventType(params.id, user.id, parsed.data);
    return NextResponse.json({ id: updated.id, slug: updated.slug });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

async function deleteHandler(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  try {
    await deleteEventType(params.id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export const PUT = csrf(putHandler);
export const DELETE = csrf(deleteHandler);
