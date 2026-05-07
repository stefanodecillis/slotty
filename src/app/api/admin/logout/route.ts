import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { lucia } from '@/lib/auth/lucia';
import { csrf } from '@/lib/auth/csrf';

export const dynamic = 'force-dynamic';

async function handler(req: NextRequest): Promise<Response> {
  const cookieStore = cookies();
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null;
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

  return NextResponse.redirect(new URL('/admin/login', req.url), { status: 303 });
}

export const POST = csrf(handler);
