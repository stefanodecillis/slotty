/**
 * OAuth2 client wrapper for Google integrations.
 *
 * Responsibilities:
 *   - Build the consent URL with the right scopes (Calendar read + write).
 *   - Hydrate an authenticated `OAuth2Client` for a specific
 *     `ConnectedAccount`, decrypting tokens from the DB.
 *   - Persist refreshed access tokens (encrypted) the moment Google issues
 *     them — by listening on the OAuth2 client's `tokens` event.
 *   - Mark accounts `needs_reauth` when the refresh token itself becomes
 *     invalid, so the admin sees a banner.
 *
 * Tokens are NEVER logged. The encryption key comes from
 * `SLOTTY_ENCRYPTION_KEY` via `src/lib/crypto.ts`.
 */
import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { encrypt, decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  // userinfo.email so we can identify the connected account.
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Buffer for proactive refresh: refresh once we're inside the last 20% of token lifetime. */
const PROACTIVE_REFRESH_RATIO = 0.2;
/** Default access-token lifetime when Google omits it (1h fallback). */
const DEFAULT_ACCESS_LIFETIME_MS = 60 * 60 * 1000;

function redirectUri(): string {
  // Google requires an exact match on this. Configure the same value in the
  // Google Cloud Console under "Authorized redirect URIs".
  const base = env.SLOTTY_PUBLIC_URL.replace(/\/$/, '');
  return `${base}/api/admin/calendars/callback`;
}

/**
 * Construct a fresh OAuth2 client. No credentials attached yet.
 * Suitable for `getToken()` exchange or building the consent URL.
 */
export function getOAuth2Client(): OAuth2Client {
  const clientId = env.SLOTTY_GOOGLE_CLIENT_ID;
  const clientSecret = env.SLOTTY_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth not configured: SLOTTY_GOOGLE_CLIENT_ID / SLOTTY_GOOGLE_CLIENT_SECRET missing');
  }
  return new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri: redirectUri(),
  });
}

/**
 * Build the consent URL the admin's browser is redirected to. We always pass
 * `prompt=consent` so Google issues a refresh token even on re-authorization.
 * `state` is a CSRF binding tied to the admin's session.
 */
export function buildAuthUrl(state: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

/**
 * Decrypt + return a per-account `OAuth2Client` with credentials and a
 * `tokens` listener that persists refreshed access tokens.
 *
 * The OAuth2 client refreshes tokens on demand inside `googleapis` requests.
 * We additionally do a proactive refresh if the token is near expiry.
 */
export async function getAuthedClient(accountId: string): Promise<OAuth2Client> {
  const account = await db.connectedAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`ConnectedAccount not found: ${accountId}`);
  if (account.status === 'disconnected') {
    throw new Error(`ConnectedAccount ${accountId} is disconnected`);
  }

  const client = getOAuth2Client();

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decrypt(account.accessTokenEnc);
    refreshToken = decrypt(account.refreshTokenEnc);
  } catch (err) {
    logger.error(
      { event: 'google.token_decrypt_failed', accountId },
      'failed to decrypt OAuth tokens',
    );
    throw err;
  }

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.expiresAt.getTime(),
    scope: account.scopes,
    token_type: 'Bearer',
  });

  // Persist refreshed tokens. The googleapis library emits this event with
  // either { access_token } (refresh) or { access_token, refresh_token }
  // (very rare — Google occasionally rotates refresh tokens).
  client.on('tokens', (tokens: Credentials) => {
    void persistRefreshedTokens(accountId, tokens).catch((err) => {
      logger.error(
        { event: 'google.token_persist_failed', accountId, err: String(err) },
        'failed to persist refreshed tokens',
      );
    });
  });

  // Proactive refresh: if we're inside the last 20% of the lifetime, force
  // a refresh now so the next API call doesn't pay that latency. This is a
  // soft optimisation — failures are non-fatal.
  if (shouldRefreshNow(account.expiresAt)) {
    try {
      const { credentials } = await client.refreshAccessToken();
      // refreshAccessToken does NOT emit the `tokens` event in all versions;
      // persist explicitly.
      await persistRefreshedTokens(accountId, credentials);
    } catch (err) {
      const code = (err as { code?: number; response?: { status?: number } })?.response?.status;
      if (code === 400 || code === 401) {
        await markAccountNeedsReauth(accountId);
        throw new Error(`Refresh token rejected for account ${accountId}; marked needs_reauth`);
      }
      logger.warn(
        { event: 'google.proactive_refresh_failed', accountId },
        'proactive refresh failed; will retry on demand',
      );
    }
  }

  return client;
}

function shouldRefreshNow(expiresAt: Date): boolean {
  // We don't know the original lifetime, but for typical 1h tokens, refresh
  // once we're within 20% (12 min) of expiry. Conservative formula: refresh
  // if remaining < DEFAULT_ACCESS_LIFETIME_MS * PROACTIVE_REFRESH_RATIO.
  const msRemaining = expiresAt.getTime() - Date.now();
  return msRemaining < DEFAULT_ACCESS_LIFETIME_MS * PROACTIVE_REFRESH_RATIO;
}

async function persistRefreshedTokens(accountId: string, tokens: Credentials): Promise<void> {
  if (!tokens.access_token) return;

  const data: {
    accessTokenEnc: string;
    expiresAt?: Date;
    refreshTokenEnc?: string;
    status?: string;
    lastSyncError?: string | null;
  } = {
    accessTokenEnc: encrypt(tokens.access_token),
    status: 'active',
    lastSyncError: null,
  };
  if (tokens.expiry_date) {
    data.expiresAt = new Date(tokens.expiry_date);
  } else {
    data.expiresAt = new Date(Date.now() + DEFAULT_ACCESS_LIFETIME_MS);
  }
  if (tokens.refresh_token) {
    data.refreshTokenEnc = encrypt(tokens.refresh_token);
  }

  await db.connectedAccount.update({
    where: { id: accountId },
    data,
  });
  logger.debug({ event: 'google.tokens_refreshed', accountId }, 'persisted refreshed tokens');
}

/**
 * Mark an account `needs_reauth`. Called when Google rejects our refresh
 * token (typically because the user revoked access, or the secret rotated).
 */
export async function markAccountNeedsReauth(accountId: string): Promise<void> {
  await db.connectedAccount.update({
    where: { id: accountId },
    data: { status: 'needs_reauth' },
  });
  logger.warn({ event: 'google.needs_reauth', accountId }, 'marked account needs_reauth');
}

/**
 * Exchange an OAuth authorization code for an access + refresh token pair.
 * Wrapped so tests can stub the HTTP call without reaching for googleapis
 * internals.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}> {
  const oauth = getOAuth2Client();
  const { tokens } = await oauth.getToken(code);
  if (!tokens.access_token) throw new Error('no access_token in token response');

  const expiresAt = tokens.expiry_date
    ? new Date(tokens.expiry_date)
    : new Date(Date.now() + DEFAULT_ACCESS_LIFETIME_MS);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt,
    scope: tokens.scope ?? GOOGLE_SCOPES.join(' '),
  };
}

/**
 * Resolve the email of the user who just authorized us. Tests can replace
 * this with a stub.
 */
export async function fetchAuthorizedEmail(accessToken: string): Promise<string | null> {
  const oauth = getOAuth2Client();
  oauth.setCredentials({ access_token: accessToken });
  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth });
  const { data } = await oauth2Api.userinfo.get();
  return data.email ?? null;
}

/**
 * Best-effort revoke. If the network request fails, we silently swallow
 * the error so disconnect always succeeds locally.
 */
export async function revokeRefreshToken(accountId: string): Promise<void> {
  try {
    const account = await db.connectedAccount.findUnique({ where: { id: accountId } });
    if (!account) return;
    const refreshToken = decrypt(account.refreshTokenEnc);
    const client = getOAuth2Client();
    await client.revokeToken(refreshToken);
  } catch (err) {
    logger.warn(
      { event: 'google.revoke_failed', accountId },
      'token revoke failed (continuing disconnect anyway)',
    );
  }
}
