/**
 * The participant "Import from Google Calendar" round-trip, minus the Next.js
 * plumbing (cookies / redirects live in the route handlers so this stays
 * testable under bun).
 *
 *   start    — participant POSTs the invite token. We check the poll takes
 *              imports, then hand back Google's consent URL and an
 *              encrypted, short-lived cookie that binds the OAuth `state` to
 *              that poll and to where they came from.
 *   complete — Google redirects the participant's browser to the PUBLIC
 *              callback. We verify state against the cookie, exchange the
 *              code, read free/busy once, and send the free candidate times
 *              back to the poll page in the URL fragment.
 *
 * The import only pre-fills the grid: the participant checks it and saves
 * their answer like any other. Nothing from Google is stored, and an
 * abandoned import leaves nothing behind.
 *
 * The callback is reachable by anyone on the internet, so every failure
 * collapses to a generic `google=failed` on the poll page.
 */
import { randomBytes } from 'node:crypto';

import { decrypt, encrypt, safeEqual } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import * as participantOAuth from '@/lib/google/participant-oauth';
import { freeCandidates, googleImportWindow, prepareGoogleImport } from './service';
import { encodeSpans, GOOGLE_FREE_PARAM, spansFromSlots } from './prefill';

export const POLL_OAUTH_COOKIE = 'slotty_poll_oauth';
/** Scope the cookie to the callback so it never rides along elsewhere. */
export const POLL_OAUTH_COOKIE_PATH = '/api/public/polls/google';
export const POLL_OAUTH_TTL_S = 10 * 60;

interface CookiePayload {
  nonce: string;
  pollId: string;
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
  now?: Date;
}): Promise<{ authUrl: string; cookieValue: string }> {
  const { pollId } = await prepareGoogleImport(input.inviteToken);
  const nonce = randomBytes(24).toString('base64url');
  const payload: CookiePayload = {
    nonce,
    pollId,
    returnPath: pollPath(input.inviteToken),
    issuedAt: Math.floor((input.now ?? new Date()).getTime() / 1000),
  };
  return {
    authUrl: participantOAuth.buildParticipantAuthUrl(nonce),
    // AES-GCM: the browser can carry it but can't read or forge it.
    cookieValue: encrypt(JSON.stringify(payload)),
  };
}

/** `empty`: Google showed no free candidate, so there's nothing to pre-fill. */
export type GoogleImportOutcome = 'ok' | 'empty' | 'denied' | 'failed';

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
  if (
    !payload ||
    typeof payload.returnPath !== 'string' ||
    !payload.returnPath.startsWith('/i/') ||
    typeof payload.pollId !== 'string'
  ) {
    return { redirectPath: '/', outcome: 'failed' };
  }
  // The free times ride in the fragment: the browser keeps it across the
  // redirect but never sends it to a server, so it stays out of logs.
  const back = (outcome: GoogleImportOutcome, fragment?: string) => ({
    redirectPath: `${payload!.returnPath}?google=${outcome}${fragment ? `#${fragment}` : ''}`,
    outcome,
  });

  if (input.oauthError) return back('denied');
  if (!input.code || !input.state) return back('failed');
  if (!safeEqual(input.state, payload.nonce)) return back('failed');
  if (now.getTime() / 1000 - payload.issuedAt > POLL_OAUTH_TTL_S) return back('failed');

  try {
    const window = await googleImportWindow(payload.pollId, now);
    const busy = await participantOAuth.fetchParticipantBusy(input.code, window.from, window.to);
    const free = await freeCandidates(payload.pollId, busy, now);
    if (free.length === 0) return back('empty');
    return back('ok', `${GOOGLE_FREE_PARAM}=${encodeSpans(spansFromSlots(free))}`);
  } catch (err) {
    logger.warn(
      { event: 'poll.google_import_failed', err: err instanceof Error ? err.message : String(err) },
      'participant Google import failed',
    );
    return back('failed');
  }
}
