/**
 * The participant "Import from Google Calendar" round-trip, minus the Next.js
 * plumbing (cookies / redirects live in the route handlers so this stays
 * testable under bun).
 *
 *   start    — participant POSTs the invite token plus either their personal
 *              token (re-import) or, for someone new, their name / email /
 *              timezone. We check they may import, then hand back Google's
 *              consent URL and an encrypted, short-lived cookie that binds
 *              the OAuth `state` to that participant (or those details) and
 *              to where they came from.
 *   complete — Google redirects the participant's browser to the PUBLIC
 *              callback. We verify state against the cookie, exchange the
 *              code, read free/busy once, turn it into votes, and send them
 *              back to the poll page. Nothing from Google is stored.
 *
 * A new participant is only saved once Google shows at least one free
 * candidate — an abandoned or empty import leaves no empty answer behind.
 * Their personal token comes back as `?p=`, like a personal link.
 *
 * The callback is reachable by anyone on the internet, so every failure
 * collapses to a generic `google=failed` on the poll page.
 */
import { randomBytes } from 'node:crypto';

import { decrypt, encrypt, safeEqual } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import * as participantOAuth from '@/lib/google/participant-oauth';
import {
  applyGoogleBusy,
  createParticipantFromGoogle,
  googleImportWindow,
  PollError,
  prepareGoogleImport,
  type ParticipantDetails,
} from './service';

export const POLL_OAUTH_COOKIE = 'slotty_poll_oauth';
/** Scope the cookie to the callback so it never rides along elsewhere. */
export const POLL_OAUTH_COOKIE_PATH = '/api/public/polls/google';
export const POLL_OAUTH_TTL_S = 10 * 60;

interface CookiePayload {
  nonce: string;
  pollId: string;
  /** Re-import for an existing participant… */
  participantId: string | null;
  /** …or the details of someone new, saved only if Google shows free time. */
  details: ParticipantDetails | null;
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
  participantToken: string | null;
  /** Required without a participant token. */
  details?: ParticipantDetails;
  now?: Date;
}): Promise<{ authUrl: string; cookieValue: string }> {
  if (!input.participantToken && !input.details) {
    throw new PollError('Enter your name and email first.', 400);
  }
  const { pollId, participantId } = await prepareGoogleImport(
    input.inviteToken,
    input.participantToken,
  );
  const nonce = randomBytes(24).toString('base64url');
  const payload: CookiePayload = {
    nonce,
    pollId,
    participantId,
    details: participantId ? null : input.details!,
    returnPath: pollPath(input.inviteToken),
    issuedAt: Math.floor((input.now ?? new Date()).getTime() / 1000),
  };
  return {
    authUrl: participantOAuth.buildParticipantAuthUrl(nonce),
    // AES-GCM: the browser can carry it but can't read or forge it.
    cookieValue: encrypt(JSON.stringify(payload)),
  };
}

/** `empty`: Google showed no free candidate, so nothing was saved or changed. */
export type GoogleImportOutcome = 'ok' | 'empty' | 'full' | 'denied' | 'failed';

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
  const back = (outcome: GoogleImportOutcome, participantToken?: string) => ({
    redirectPath:
      `${payload!.returnPath}?google=${outcome}` +
      (participantToken ? `&p=${encodeURIComponent(participantToken)}` : ''),
    outcome,
  });

  if (input.oauthError) return back('denied');
  if (!input.code || !input.state) return back('failed');
  if (!safeEqual(input.state, payload.nonce)) return back('failed');
  if (now.getTime() / 1000 - payload.issuedAt > POLL_OAUTH_TTL_S) return back('failed');

  try {
    const window = await googleImportWindow(payload.pollId, now);
    const busy = await participantOAuth.fetchParticipantBusy(input.code, window.from, window.to);
    if (payload.participantId) {
      const { availableSlots } = await applyGoogleBusy(payload.participantId, busy, now);
      return back(availableSlots > 0 ? 'ok' : 'empty');
    }
    if (!payload.details) return back('failed');
    const created = await createParticipantFromGoogle(payload.pollId, payload.details, busy, now);
    return created.participantToken ? back('ok', created.participantToken) : back('empty');
  } catch (err) {
    if (err instanceof PollError && err.status === 409) return back('full');
    logger.warn(
      { event: 'poll.google_import_failed', err: err instanceof Error ? err.message : String(err) },
      'participant Google import failed',
    );
    return back('failed');
  }
}
