/**
 * GET  /api/admin/site-url — return the current override and env fallback
 * PUT  /api/admin/site-url — set or clear the override
 *
 * The override only affects user-facing URLs (invite links, manage links,
 * admin "copy public link" buttons). Load-bearing config (Google OAuth
 * redirect URI, webhook channel address, cookie security) still comes
 * from `SLOTTY_PUBLIC_URL` and requires a container restart to change.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { getPublicUrlState, setPublicUrl, InvalidPublicUrlError } from '@/lib/site-url/store';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  await requireUser();
  const state = await getPublicUrlState();
  return NextResponse.json(state);
}

const bodySchema = z.object({
  // Empty string clears the override. The store helper also accepts null.
  url: z.string().max(2048),
});

async function putHandler(req: NextRequest): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const trimmed = parsed.data.url.trim();
  const previousState = await getPublicUrlState();

  try {
    await setPublicUrl(trimmed === '' ? null : trimmed);
  } catch (err) {
    if (err instanceof InvalidPublicUrlError) {
      return NextResponse.json({ error: err.message, code: 'INVALID_URL' }, { status: 400 });
    }
    throw err;
  }

  const next = await getPublicUrlState();
  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'site_url.update',
    metadata: {
      previousOverride: previousState.override,
      nextOverride: next.override,
      envValue: next.envValue,
    },
    ip: getClientIp(req.headers),
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.json(next);
}

export const PUT = csrf(putHandler);
