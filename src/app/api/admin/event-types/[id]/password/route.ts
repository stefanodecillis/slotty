import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { setEventTypePassword, ServiceError } from '@/lib/eventtype/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

async function handler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  let body: { password?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const password = body?.password ?? null;

  if (password !== null && (typeof password !== 'string' || password.length < 8)) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 422 },
    );
  }

  try {
    await setEventTypePassword(params.id, user.id, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export const PUT = csrf(handler);
