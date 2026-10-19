/**
 * The participant "Import from Google Calendar" round-trip, minus the Next.js
 * plumbing (cookies / redirects live in the route handlers so this stays
 * testable under bun).
 *
 *   start    — participant POSTs the invite token + their personal token.
 *              We check they may import, then hand back Google's consent URL
 *              and an encrypted, short-lived cookie that binds the OAuth
 *              `state` to that participant and to where they came from.
 *   complete — Google redirects the participant's browser to the PUBLIC
 *              callback. We verify state against the cookie, exchange the
 *              code, read free/busy once, turn it into votes, and send them
 *              back to the poll page. Nothing from Google is stored.
 *
 * The callback is reachable by anyone on the internet, so every failure
 * collapses to a generic `google=failed` on the poll page.
 */
import { randomBytes } from 'node:crypto';

import { decrypt, encrypt, safeEqual } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import * as participantOAuth from '@/lib/google/participant-oauth';
import { applyGoogleBusy, googleImportWindow, prepareGoogleImport } from './service';

export const POLL_OAUTH_COOKIE = 'slotty_poll_oauth';
/** Scope the cookie to the callback so it never rides along elsewhere. */
export const POLL_OAUTH_COOKIE_PATH = '/api/public/polls/google';
export const POLL_OAUTH_TTL_S = 10 * 60;

interface CookiePayload {
  nonce: string;
  participantId: string;
  returnPath: string;
  issuedAt: number;
}

export function pollCookieSecure(): boolean {
  return new URL(env.SLOTTY_PUBLIC_URL).protocol === 'https:';
}

function pollPath(inviteToken: string): string {
  return `/i/${encodeURIComponent(inviteToken)}`;
}

export async function startGoogleImport(input: {
  inviteToken: string;
  participantToken: string;
  now?: Date;
}): Promise<{ authUrl: string; cookieValue: string }> {
  const { participantId } = await prepareGoogleImport(input.inviteToken, input.participantToken);
  const nonce = randomBytes(24).toString('base64url');
  const payload: CookiePayload = {
    nonce,
    participantId,
    returnPath: pollPath(input.inviteToken),
    issuedAt: Math.floor((input.now ?? new Date()).getTime() / 1000),
  };
  return {
    authUrl: participantOAuth.buildParticipantAuthUrl(nonce),
    // AES-GCM: the browser can carry it but can't read or forge it.
    cookieValue: encrypt(JSON.stringify(payload)),
  };
}

export type GoogleImportOutcome = 'ok' | 'denied' | 'failed';

export async function completeGoogleImport(input: {
  code: string | null;
  state: string | null;
  oauthError: string | null;
  cookieValue: string | null;
  now?: Date;
}): Promise<{ redirectPath: string; outcome: GoogleImportOutcome }> {
  const now = input.now ?? new Date();

  let payload: CookiePayload | null = null;
  if (input.cookieValue) {
    try {
      payload = JSON.parse(decrypt(input.cookieValue)) as CookiePayload;
    } catch {
      payload = null;
    }
  }
  // Without a valid cookie we don't even know which poll to go back to.
  if (!payload || typeof payload.returnPath !== 'string' || !payload.returnPath.startsWith('/i/')) {
    return { redirectPath: '/', outcome: 'failed' };
  }
  const back = (outcome: GoogleImportOutcome) => ({
    redirectPath: `${payload!.returnPath}?google=${outcome}`,
    outcome,
  });

  if (input.oauthError) return back('denied');
  if (!input.code || !input.state) return back('failed');
  if (!safeEqual(input.state, payload.nonce)) return back('failed');
  if (now.getTime() / 1000 - payload.issuedAt > POLL_OAUTH_TTL_S) return back('failed');

  try {
    const window = await googleImportWindow(payload.participantId, now);
    const busy = await participantOAuth.fetchParticipantBusy(input.code, window.from, window.to);
    await applyGoogleBusy(payload.participantId, busy, now);
    return back('ok');
  } catch (err) {
    logger.warn(
      { event: 'poll.google_import_failed', err: err instanceof Error ? err.message : String(err) },
      'participant Google import failed',
    );
    return back('failed');
  }
}
