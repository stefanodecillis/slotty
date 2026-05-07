import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { lucia } from '@/lib/auth/lucia';
import { csrf } from '@/lib/auth/csrf';
import { getCurrentSession } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest): Promise<Response> {
  const cookieStore = cookies();
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null;
  const { user } = await getCurrentSession();
  const ip = getClientIp(req.headers);

  if (sessionId) {
    try {
      await lucia.invalidateSession(sessionId);
    } catch (err) {
      logger.warn({ event: 'auth.logout_failed', err }, 'failed to invalidate session');
    }
  }

  const blank = lucia.createBlankSessionCookie();
  cookieStore.set(blank.name, blank.value, blank.attributes);

  logger.info({ event: 'auth.logout' }, 'logout');
  await recordAudit({
    userId: user?.id,
    actor: 'owner',
    action: 'logout',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.redirect(new URL('/admin/login', req.url), { status: 303 });
}

export const POST = csrf(handler);
