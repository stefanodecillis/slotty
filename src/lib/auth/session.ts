import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Session, User } from 'lucia';

import { lucia } from './lucia';
import { logger } from '@/lib/logger';

export type CurrentSession =
  | { user: User; session: Session }
  | { user: null; session: null };

/**
 * Read + validate the session cookie. Cached per-request via React `cache`
 * so multiple server components / actions share one DB lookup per render.
 *
 * Lucia v3 returns `session.fresh = true` when the session has been refreshed
 * (we passed the half-life threshold and Lucia extended the expiry server
 * side). When fresh, we must rewrite the cookie so the client sees the new
 * expiry. We swallow cookie-mutation errors because Next forbids mutating
 * cookies in pure server components — the route handler / action catches
 * the next refresh anyway.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession> => {
  const cookieStore = cookies();
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null;
  if (!sessionId) {
    return { user: null, session: null };
  }

  const result = await lucia.validateSession(sessionId);

  try {
    if (result.session && result.session.fresh) {
      const sessionCookie = lucia.createSessionCookie(result.session.id);
      cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
    }
    if (!result.session) {
      const blank = lucia.createBlankSessionCookie();
      cookieStore.set(blank.name, blank.value, blank.attributes);
    }
  } catch {
    // Server components cannot mutate cookies. The next request through a
    // route handler / server action will refresh.
  }

  return result;
});

export async function requireUser(): Promise<User> {
  const { user } = await getCurrentSession();
  if (!user) {
    logger.warn({ event: 'auth.unauthorized' }, 'requireUser rejected request');
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  return user;
}

export async function requireUserOrRedirect(redirectTo = '/admin/login'): Promise<User> {
  const { user } = await getCurrentSession();
  if (!user) {
    redirect(redirectTo);
  }
  return user;
}
