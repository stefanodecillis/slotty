/**
 * Toggle `isBusySource` or `isDestinationEligible` for a single calendar.
 * Single endpoint for the admin UI's per-row switches.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = new Set(['isBusySource', 'isDestinationEligible']);

async function handler(req: NextRequest): Promise<Response> {
  await requireUser();

  let body: { calendarId?: string; field?: string; value?: boolean | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const { calendarId, field } = body;
  const value = typeof body.value === 'string' ? body.value === 'true' : Boolean(body.value);

  if (!calendarId || !field || !ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ error: 'calendarId + field required' }, { status: 400 });
  }

  await db.calendar.update({
    where: { id: calendarId },
    data: { [field]: value },
  });

  return NextResponse.json({ ok: true });
}

export const POST = csrf(handler);
