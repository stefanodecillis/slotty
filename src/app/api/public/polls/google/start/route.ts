/**
 * POST /api/public/polls/google/start — form POST from the poll page:
 * `inviteToken` plus either `participantToken` (re-import) or `name`,
 * `email` and `timezone` (someone new, saved only once Google comes back
 * with free time). Sets the encrypted state cookie and 303s the
 * participant's browser to Google's consent screen.
 *
 * Public on purpose: participants aren't on the owner's private network.
 * See `src/lib/group-poll/google-flow.ts`.
 *
 * Same-origin only. Otherwise another site could auto-submit this form with
 * the attacker's own personal token, and whoever picks a Google account on
 * the consent screen would pour their free/busy into the attacker's answer.
 */
import { cookies } from 'next/headers';
import { DateTime } from 'luxon';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isSameOriginRequest } from '@/lib/auth/csrf';
import { env } from '@/lib/env';
import { getClientIp } from '@/lib/http/client-ip';
import { consume } from '@/lib/ratelimit';
import { PollError } from '@/lib/group-poll/service';
import { pollParticipantDetailsSchema } from '@/lib/group-poll/validator';
import {
  POLL_OAUTH_COOKIE,
  POLL_OAUTH_COOKIE_PATH,
  POLL_OAUTH_TTL_S,
  pollCookieSecure,
  startGoogleImport,
} from '@/lib/group-poll/google-flow';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = { capacity: 10, windowMs: 60_000 };

export async function POST(req: NextRequest): Promise<Response> {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const inviteToken = form?.get('inviteToken');
  const participantToken = form?.get('participantToken');
  if (typeof inviteToken !== 'string' || !inviteToken || inviteToken.length > 200) {
    return NextResponse.json({ error: 'Missing invite token' }, { status: 400 });
  }
  const back = new URL(`/i/${encodeURIComponent(inviteToken)}`, env.SLOTTY_PUBLIC_URL);

  const token = typeof participantToken === 'string' && participantToken ? participantToken : null;
  const details = pollParticipantDetailsSchema.safeParse({
    name: form?.get('name'),
    email: form?.get('email'),
    timezone: form?.get('timezone'),
  });
  const decision = consume('public-poll-google', getClientIp(req.headers), RATE_LIMIT);
  const detailsOk = details.success && DateTime.now().setZone(details.data.timezone).isValid;
  if (!decision.allowed || (!token && !detailsOk)) {
    back.searchParams.set('google', 'failed');
    return NextResponse.redirect(back, { status: 303 });
  }

  try {
    const { authUrl, cookieValue } = await startGoogleImport({
      inviteToken,
      participantToken: token,
      details: detailsOk ? details.data : undefined,
    });
    cookies().set(POLL_OAUTH_COOKIE, cookieValue, {
      httpOnly: true,
      secure: pollCookieSecure(),
      // Lax is still sent on Google's top-level GET redirect back to us.
      sameSite: 'lax',
      path: POLL_OAUTH_COOKIE_PATH,
      maxAge: POLL_OAUTH_TTL_S,
    });
    return NextResponse.redirect(authUrl, { status: 303 });
  } catch (err) {
    if (!(err instanceof PollError)) throw err;
    back.searchParams.set('google', err.status === 409 ? 'full' : 'failed');
    return NextResponse.redirect(back, { status: 303 });
  }
}
