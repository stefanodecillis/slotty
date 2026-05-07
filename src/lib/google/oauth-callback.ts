/**
 * Pure logic for the OAuth callback. Extracted from the Next route handler
 * so tests can drive it without dragging in `next/headers` (which itself
 * pulls in React server-rendering machinery that doesn't load cleanly in
 * the bun test runtime).
 *
 * The route handler is a thin wrapper that:
 *   - reads the state cookie via next/headers
 *   - resolves the user via the session helper
 *   - calls `handleOAuthCallback({ code, stateFromGoogle, stateCookie, userId })`
 *
 * This function returns either a `Response` to send back, or a sentinel for
 * the wrapping route to convert into a redirect.
 */
import { db } from '@/lib/db';
import { encrypt, hmac, safeEqual } from '@/lib/crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

import * as googleClient from './client';
import * as googleCalendar from './calendar';
import { enqueueJob } from '@/lib/jobs/scheduler';
import * as syncWatch from '@/lib/sync/watch';

const STATE_TTL_S = 10 * 60;

export interface CallbackInput {
  code: string | null;
  stateFromGoogle: string | null;
  stateCookie: string | null;
  /** The authenticated admin's user id (used to bind the state token). */
  userId: string;
  /** Google's `error` query param (passed when the user denies consent). */
  oauthError?: string | null;
}

export interface CallbackOutcome {
  status: 'success' | 'failed';
  /** "ok" on success; failure code otherwise. Encoded in the redirect URL. */
  reason: string;
  accountId?: string;
  calendarsCreated?: number;
}

export async function handleOAuthCallback(input: CallbackInput): Promise<CallbackOutcome> {
  const { code, stateFromGoogle, stateCookie, userId, oauthError } = input;

  if (oauthError) return done('failed', `google_${oauthError}`);
  if (!code || !stateFromGoogle) return done('failed', 'missing_code_or_state');
  if (!stateCookie) return done('failed', 'missing_state_cookie');
  if (!safeEqual(stateFromGoogle, stateCookie)) return done('failed', 'state_mismatch');

  // Validate the HMAC + age inside the state token itself.
  const parts = stateFromGoogle.split('.');
  if (parts.length !== 4) return done('failed', 'state_format');
  const [stateUserId, issuedAtStr, nonce, sig] = parts;
  if (!stateUserId || !issuedAtStr || !nonce || !sig) return done('failed', 'state_missing_parts');
  const expectedSig = hmac(env.SLOTTY_SESSION_SECRET, `${stateUserId}.${issuedAtStr}.${nonce}`);
  if (!safeEqual(sig, expectedSig)) return done('failed', 'state_sig');
  if (stateUserId !== userId) return done('failed', 'state_user_mismatch');
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt) || Math.abs(Math.floor(Date.now() / 1000) - issuedAt) > STATE_TTL_S) {
    return done('failed', 'state_expired');
  }

  // Exchange code → tokens.
  let tokens;
  try {
    tokens = await googleClient.exchangeCodeForTokens(code);
  } catch (err) {
    logger.error({ event: 'oauth.token_exchange_failed' }, 'token exchange failed');
    return done('failed', 'token_exchange');
  }

  if (!tokens.refreshToken) {
    // No refresh token means re-consent without revoking; can't recover.
    return done('failed', 'no_refresh_token');
  }

  // Identify the Google account.
  let email: string | null;
  try {
    email = await googleClient.fetchAuthorizedEmail(tokens.accessToken);
  } catch (err) {
    logger.error({ event: 'oauth.userinfo_failed' }, 'userinfo fetch failed');
    return done('failed', 'userinfo');
  }
  if (!email) return done('failed', 'no_email');

  // Upsert ConnectedAccount.
  const account = await db.connectedAccount.upsert({
    where: {
      provider_googleUserEmail: { provider: 'google', googleUserEmail: email },
    },
    create: {
      provider: 'google',
      googleUserEmail: email,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      scopes: tokens.scope,
      expiresAt: tokens.expiresAt,
      status: 'active',
    },
    update: {
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      scopes: tokens.scope,
      expiresAt: tokens.expiresAt,
      status: 'active',
      lastSyncError: null,
    },
  });

  // Discover calendars + upsert.
  let gcals;
  try {
    gcals = await googleCalendar.listCalendars(account.id);
  } catch (err) {
    logger.error(
      { event: 'oauth.list_calendars_failed', accountId: account.id },
      'listCalendars failed',
    );
    return { status: 'failed', reason: 'list_calendars', accountId: account.id };
  }

  const newCalendarIds: string[] = [];
  for (const g of gcals) {
    const cal = await db.calendar.upsert({
      where: {
        connectedAccountId_googleCalendarId: {
          connectedAccountId: account.id,
          googleCalendarId: g.id,
        },
      },
      create: {
        connectedAccountId: account.id,
        googleCalendarId: g.id,
        name: g.summary,
        description: g.description ?? null,
        timezone: g.timeZone ?? null,
        backgroundColor: g.backgroundColor ?? null,
        isPrimary: g.primary,
        isBusySource: g.primary, // default: only the primary calendar blocks
        isDestinationEligible: g.primary, // default: primary is destination
      },
      update: {
        name: g.summary,
        description: g.description ?? null,
        timezone: g.timeZone ?? null,
        backgroundColor: g.backgroundColor ?? null,
        isPrimary: g.primary,
      },
    });
    newCalendarIds.push(cal.id);
  }

  // Schedule incremental_sync + watch setup for each.
  for (const id of newCalendarIds) {
    try {
      await enqueueJob('incremental_sync', { calendarId: id });
    } catch (err) {
      logger.warn(
        { event: 'oauth.enqueue_sync_failed', calendarId: id },
        'failed to enqueue initial sync',
      );
    }
    try {
      await syncWatch.setupWatchChannel(id);
    } catch (err) {
      logger.warn(
        { event: 'oauth.setup_watch_failed', calendarId: id },
        'failed to set up watch channel',
      );
    }
  }

  logger.info(
    { event: 'oauth.callback.success', accountId: account.id, calendars: newCalendarIds.length },
    'oauth callback complete',
  );

  return {
    status: 'success',
    reason: 'ok',
    accountId: account.id,
    calendarsCreated: newCalendarIds.length,
  };
}

function done(status: 'failed', reason: string): CallbackOutcome {
  logger.warn({ event: 'oauth.callback.failed', reason }, 'oauth callback rejected');
  return { status, reason };
}
