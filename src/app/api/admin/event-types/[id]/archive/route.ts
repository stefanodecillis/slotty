import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { archiveEventType, unarchiveEventType, ServiceError } from '@/lib/eventtype/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

async function handler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  let body: { archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const shouldArchive = Boolean(body?.archived);

  try {
    if (shouldArchive) {
      await archiveEventType(params.id, user.id);
    } else {
      await unarchiveEventType(params.id, user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export const POST = csrf(handler);
