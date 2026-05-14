import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { eventTypeInputSchema } from '@/lib/eventtype/validator';
import { createEventType, ServiceError, slugify, ensureUniqueSlug } from '@/lib/eventtype/service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);
  const archivedParam = searchParams.get('archived');

  // isOneTime EventTypes are managed in their own admin section
  // (GET /api/admin/one-time-links). Keep them out of the normal list.
  const where =
    archivedParam === 'true'
      ? { userId: user.id, archived: true, isOneTime: false }
      : { userId: user.id, archived: false, isOneTime: false };

  const eventTypes = await db.eventType.findMany({
    where,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      questions: { orderBy: { position: 'asc' } },
      destinationCalendar: { select: { name: true } },
      destinationAccount: { select: { googleUserEmail: true } },
    },
  });

  return NextResponse.json(eventTypes);
}

async function postHandler(req: NextRequest): Promise<Response> {
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

  const input = parsed.data;
  // Ensure slug is unique; the validator already ensured it's non-empty and valid format.
  input.slug = await ensureUniqueSlug(user.id, input.slug);

  try {
    const eventType = await createEventType(user.id, input);
    return NextResponse.json({ id: eventType.id, slug: eventType.slug }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }
}

export const POST = csrf(postHandler);
