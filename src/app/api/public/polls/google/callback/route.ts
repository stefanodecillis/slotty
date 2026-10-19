/**
 * GET /api/public/polls/google/callback — Google's redirect target for
 * participants importing free/busy into a group poll.
 *
 * Must be reachable from the internet: register
 * `<SLOTTY_PUBLIC_URL>/api/public/polls/google/callback` as a second
 * authorized redirect URI next to the owner's admin callback. Google never
 * calls it server-to-server — the participant's browser does.
 *
 * The `code` is exchanged immediately and the browser is redirected to a
 * clean URL, so it doesn't linger in history. No-referrer keeps it out of
 * any outgoing Referer header too.
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';
import {
  completeGoogleImport,
  POLL_OAUTH_COOKIE,
  POLL_OAUTH_COOKIE_PATH,
} from '@/lib/group-poll/google-flow';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { capacity: 20, windowMs: 60_000 };

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const cookieStore = cookies();
  const cookieValue = cookieStore.get(POLL_OAUTH_COOKIE)?.value ?? null;
  cookieStore.set(POLL_OAUTH_COOKIE, '', { path: POLL_OAUTH_COOKIE_PATH, maxAge: 0 });

  const decision = consume('public-poll-google-callback', getClientIp(req.headers), RATE_LIMIT);
  const { redirectPath } = decision.allowed
    ? await completeGoogleImport({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        oauthError: url.searchParams.get('error'),
        cookieValue,
      })
    : { redirectPath: '/' };

  const res = NextResponse.redirect(new URL(redirectPath, env.SLOTTY_PUBLIC_URL), { status: 303 });
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
