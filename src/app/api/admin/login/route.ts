import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { lucia } from '@/lib/auth/lucia';
import { verifyPassword } from '@/lib/auth/password';
import { csrf } from '@/lib/auth/csrf';
import { getClientIp } from '@/lib/http/client-ip';
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/auth/rate-limit';
import { recordAudit } from '@/lib/audit';
import { hmac } from '@/lib/crypto';
import { env } from '@/lib/env';

const TOTP_PENDING_COOKIE = 'slotty_totp_pending';
const TOTP_PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

function createPendingToken(userId: string): string {
  const expiresAt = Date.now() + TOTP_PENDING_TTL_MS;
  const payload = JSON.stringify({ userId, expiresAt });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = hmac(env.SLOTTY_SESSION_SECRET, payload);
  return `${payloadB64}.${sig}`;
}

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1024),
  next: z.string().optional(),
});

const SAFE_NEXT_RE = /^\/[^\/].*$/u;
function sanitizeNext(next: string | undefined): string {
  if (!next) return '/admin';
  if (!SAFE_NEXT_RE.test(next)) return '/admin';
  if (next.startsWith('//')) return '/admin';
  return next;
}

/**
 * Pre-computed argon2id hash of a fixed throwaway string. We always run a
 * verify against this when no user is found so the response time matches a
 * real login + bad password and we don't reveal whether the username exists.
 *
 * The hash is regenerated on first import so a leaked binary doesn't expose
 * a fixed comparison value to attackers.
 */
let dummyHashPromise: Promise<string> | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    const { hashPassword } = await import('@/lib/auth/password');
    dummyHashPromise = hashPassword('dummy-password-for-timing-only');
  }
  return dummyHashPromise;
}

function loginRedirect(req: NextRequest, message: string, next: string): Response {
  const url = new URL('/admin/login', req.url);
  url.searchParams.set('error', message);
  if (next !== '/admin') url.searchParams.set('next', next);
  return NextResponse.redirect(url, { status: 303 });
}

async function handler(req: NextRequest): Promise<Response> {
  const ip = getClientIp(req.headers);
  const next = sanitizeNext(undefined);

  const limit = await checkLoginRateLimit(ip);
  if (!limit.allowed) {
    logger.warn(
      { event: 'auth.rate_limited', ip, retryAfterSec: limit.retryAfterSec },
      'login rate limited',
    );
    return new Response(
      JSON.stringify({
        error: 'Too many failed attempts. Try again later.',
        retryAfterSec: limit.retryAfterSec,
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(limit.retryAfterSec),
        },
      },
    );
  }

  const formData = await req.formData();
  const parsed = loginSchema.safeParse({
    username: formData.get('username')?.toString() ?? '',
    password: formData.get('password')?.toString() ?? '',
    next: formData.get('next')?.toString(),
  });
  if (!parsed.success) {
    await recordLoginAttempt(ip, false);
    return loginRedirect(req, 'Invalid credentials', next);
  }

  const formNext = sanitizeNext(parsed.data.next);

  const user = await db.user.findUnique({
    where: { username: parsed.data.username },
  });

  let valid = false;
  if (user) {
    valid = await verifyPassword(user.passwordHash, parsed.data.password);
  } else {
    // Run a verify against a dummy hash so timing matches the user-found path.
    await verifyPassword(await getDummyHash(), parsed.data.password);
  }

  if (!user || !valid) {
    await recordLoginAttempt(ip, false);
    logger.warn(
      { event: 'auth.login_failed', ip, username: parsed.data.username },
      'login failed',
    );
    await recordAudit({
      actor: 'owner',
      action: 'login.failed',
      ip,
      userAgent: req.headers.get('user-agent') ?? undefined,
      metadata: { username: parsed.data.username },
    });
    return loginRedirect(req, 'Invalid credentials', formNext);
  }

  await recordLoginAttempt(ip, true);

  // Check if TOTP is required.
  if (user.totpEnabled) {
    const pendingToken = createPendingToken(user.id);
    cookies().set(TOTP_PENDING_COOKIE, pendingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: TOTP_PENDING_TTL_MS / 1000,
    });
    logger.info({ event: 'auth.totp_required', userId: user.id, ip }, 'TOTP required');
    const url = new URL('/admin/login', req.url);
    url.searchParams.set('step', 'totp');
    if (formNext !== '/admin') url.searchParams.set('next', formNext);
    return NextResponse.redirect(url, { status: 303 });
  }

  const session = await lucia.createSession(user.id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  logger.info({ event: 'auth.login_success', userId: user.id, ip }, 'login success');
  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'login',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.redirect(new URL(formNext, req.url), { status: 303 });
}

export const POST = csrf(handler);
