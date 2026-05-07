import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { reorderEventTypes, ServiceError } from '@/lib/eventtype/service';

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest): Promise<Response> {
  const user = await requireUser();

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 422 });
  }

  try {
    await reorderEventTypes(user.id, ids as string[]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }
}

export const PUT = csrf(handler);
