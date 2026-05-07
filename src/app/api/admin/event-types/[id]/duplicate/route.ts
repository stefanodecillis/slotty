import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { duplicateEventType, ServiceError } from '@/lib/eventtype/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

async function handler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  try {
    const copy = await duplicateEventType(params.id, user.id);
    return NextResponse.json({ id: copy.id, slug: copy.slug }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export const POST = csrf(handler);
