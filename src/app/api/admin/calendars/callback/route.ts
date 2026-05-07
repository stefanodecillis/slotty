/**
 * OAuth callback. Receives `code` + `state` from Google, exchanges the code
 * for tokens, stores them encrypted, fetches the calendar list, and kicks
 * off an initial sync + watch channel for each.
 *
 * Re-connecting an existing Google account refreshes its tokens and
 * reactivates the row but preserves dependent calendars (so existing
 * EventTypes / bookings keep working).
 *
 * The bulk of the work lives in `@/lib/google/oauth-callback`; this handler
 * is just the framework adapter (cookies + redirect).
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { handleOAuthCallback } from '@/lib/google/oauth-callback';

import { OAUTH_STATE_COOKIE } from '../connect/route';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fcalendars');

  const url = new URL(req.url);

  const cookieStore = cookies();
  const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? null;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  const outcome = await handleOAuthCallback({
    code: url.searchParams.get('code'),
    stateFromGoogle: url.searchParams.get('state'),
    stateCookie,
    userId: user.id,
    oauthError: url.searchParams.get('error'),
  });

  const target = new URL('/admin/calendars', env.SLOTTY_PUBLIC_URL);
  if (outcome.status !== 'success') {
    target.searchParams.set('error', outcome.reason);
  }
  return NextResponse.redirect(target, { status: 303 });
}
