/**
 * Step 1 of the OAuth dance.
 *
 * Generates a CSRF state token (HMAC of userId + timestamp), stores it in a
 * short-lived HttpOnly cookie, and redirects the admin's browser to Google's
 * consent screen. The callback compares the state echoed back by Google to
 * the cookie before exchanging the code for tokens.
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { requireUserOrRedirect } from '@/lib/auth/session';
import { hmac } from '@/lib/crypto';
import { env } from '@/lib/env';
import { buildAuthUrl } from '@/lib/google/client';

export const dynamic = 'force-dynamic';

export const OAUTH_STATE_COOKIE = 'slotty_oauth_state';
const STATE_TTL_S = 10 * 60; // 10 minutes

export async function GET(_req: NextRequest): Promise<Response> {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fcalendars');

  const nonce = randomBytes(16).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  // Self-contained state so we can verify without DB roundtrip:
  // <userId>.<issuedAt>.<nonce>.<hmac(userId|issuedAt|nonce)>
  const payload = `${user.id}.${issuedAt}.${nonce}`;
  const sig = hmac(env.SLOTTY_SESSION_SECRET, payload);
  const state = `${payload}.${sig}`;

  cookies().set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_S,
  });

  const url = buildAuthUrl(state);
  return NextResponse.redirect(url, { status: 303 });
}
