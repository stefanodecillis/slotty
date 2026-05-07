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
    return loginRedirect(req, 'Invalid credentials', formNext);
  }

  const session = await lucia.createSession(user.id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  await recordLoginAttempt(ip, true);
  logger.info({ event: 'auth.login_success', userId: user.id, ip }, 'login success');

  return NextResponse.redirect(new URL(formNext, req.url), { status: 303 });
}

export const POST = csrf(handler);
