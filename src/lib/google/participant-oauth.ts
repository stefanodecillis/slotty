/**
 * Google free/busy import for group-poll participants.
 *
 * Deliberately separate from the owner's OAuth flow in `./client`:
 *   - Participants are external people on the open internet, so the
 *     redirect URI lives on the PUBLIC origin (`SLOTTY_PUBLIC_URL`), never on
 *     the private admin origin. Google's redirect is a front-channel browser
 *     navigation — only the participant's browser has to reach it; the code
 *     exchange is an outbound call from Slotty.
 *   - The only scope requested is `calendar.freebusy`: busy blocks, no
 *     titles, no details, no calendar list, no email.
 *   - Online access only. The access token is used once for a single
 *     `freebusy.query`, never stored, and left to expire on its own (about
 *     an hour). It is NOT revoked: this flow shares the owner's OAuth client,
 *     and Google's revoke drops the whole user+client grant — had the owner
 *     (or anyone whose calendar is connected) imported into a poll, revoking
 *     would also kill the refresh token on their `ConnectedAccount`.
 *     Participants are never written to `ConnectedAccount` (that table is
 *     the owner's busy sources).
 *
 * Both Google calls are exported so tests can stub them with `spyOn`.
 */
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

import { env } from '@/lib/env';

export const PARTICIPANT_SCOPES = ['https://www.googleapis.com/auth/calendar.freebusy'];

export const PARTICIPANT_CALLBACK_PATH = '/api/public/polls/google/callback';

/** Exact URI to register under "Authorized redirect URIs" in Google Cloud. */
export function participantRedirectUri(): string {
  return new URL(PARTICIPANT_CALLBACK_PATH, env.SLOTTY_PUBLIC_URL).href;
}

export type ParticipantGoogleUnavailableReason = 'not_configured' | 'public_url_not_https';

/**
 * Whether participants can import from Google on this deployment.
 *
 * Google only accepts HTTPS redirect URIs on a real domain (plain-http
 * `localhost` is the one exception). Deployments reached as
 * `http://truenas:3210` therefore can't offer it — polls fall back to
 * manual answers.
 */
export function participantGoogleAvailability():
  | { available: true }
  | { available: false; reason: ParticipantGoogleUnavailableReason } {
  if (!env.SLOTTY_GOOGLE_CLIENT_ID || !env.SLOTTY_GOOGLE_CLIENT_SECRET) {
    return { available: false, reason: 'not_configured' };
  }
  if (!isGoogleRedirectEligible(env.SLOTTY_PUBLIC_URL)) {
    return { available: false, reason: 'public_url_not_https' };
  }
  return { available: true };
}

/** Google's redirect-URI rules: HTTPS on a domain name, or plain loopback. */
export function isGoogleRedirectEligible(publicUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  return url.protocol === 'https:' && !isIp && host.includes('.');
}

function participantOAuthClient(): OAuth2Client {
  const clientId = env.SLOTTY_GOOGLE_CLIENT_ID;
  const clientSecret = env.SLOTTY_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth not configured: SLOTTY_GOOGLE_CLIENT_ID / SLOTTY_GOOGLE_CLIENT_SECRET missing');
  }
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri: participantRedirectUri() });
}

/** Consent URL for a participant. No offline access, no refresh token. */
export function buildParticipantAuthUrl(state: string): string {
  return participantOAuthClient().generateAuthUrl({
    access_type: 'online',
    scope: PARTICIPANT_SCOPES,
    state,
    // Let people pick which Google account to read from.
    prompt: 'select_account',
  });
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

/**
 * Exchange the code and read the participant's primary-calendar busy blocks
 * for [timeMin, timeMax). The token is dropped, not revoked (see above).
 * Throws on any Google error.
 */
export async function fetchParticipantBusy(
  code: string,
  timeMin: Date,
  timeMax: Date,
): Promise<BusyInterval[]> {
  const client = participantOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error('no access_token in token response');
  client.setCredentials({ access_token: tokens.access_token });

  const calendar = google.calendar({ version: 'v3', auth: client });
  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: 'primary' }],
    },
  });
  const primary = data.calendars?.primary;
  if (primary?.errors?.length) {
    throw new Error(`freebusy error: ${primary.errors.map((e) => e.reason).join(', ')}`);
  }
  const out: BusyInterval[] = [];
  for (const b of primary?.busy ?? []) {
    if (!b.start || !b.end) continue;
    const start = new Date(b.start);
    const end = new Date(b.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    out.push({ start, end });
  }
  return out;
}
