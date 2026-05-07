import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { lucia } from '@/lib/auth/lucia';
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { validateOrigin } from '@/lib/auth/csrf';

export const dynamic = 'force-dynamic';

const setupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(2, 'Username must be at least 2 characters.')
      .max(64, 'Username must be at most 64 characters.')
      .regex(/^[a-zA-Z0-9_.-]+$/u, 'Username may contain letters, digits, dot, dash, underscore.'),
    displayName: z.string().trim().min(1, 'Display name is required.').max(120),
    email: z.string().trim().email('Enter a valid email address.').max(254),
    password: z.string().min(1, 'Password is required.'),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

function redirectWithError(req: NextRequest, message: string): Response {
  const url = new URL('/setup', req.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Sanity-only origin check — there's no auth state on first run, but if a
  // cross-site request hits us we'd rather not accept it.
  if (!validateOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  if ((await db.user.count()) >= 1) {
    return new Response(JSON.stringify({ error: 'Setup already completed' }), {
      status: 410,
      headers: { 'content-type': 'application/json' },
    });
  }

  const formData = await req.formData();
  const input = {
    username: formData.get('username')?.toString() ?? '',
    displayName: formData.get('displayName')?.toString() ?? '',
    email: formData.get('email')?.toString() ?? '',
    password: formData.get('password')?.toString() ?? '',
    confirmPassword: formData.get('confirmPassword')?.toString() ?? '',
  };

  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return redirectWithError(req, firstIssue?.message ?? 'Invalid input.');
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return redirectWithError(req, strength.reason);
  }

  const passwordHash = await hashPassword(parsed.data.password);

  let createdUserId: string;
  try {
    const user = await db.$transaction(async (tx) => {
      // Re-check inside the transaction to win the race against another
      // simultaneous setup POST. SQLite serializes transactions but other
      // backends rely on the unique-violation as backstop too.
      const existing = await tx.user.count();
      if (existing >= 1) {
        throw new SetupAlreadyDoneError();
      }
      return tx.user.create({
        data: {
          username: parsed.data.username,
          displayName: parsed.data.displayName,
          email: parsed.data.email,
          passwordHash,
        },
      });
    });
    createdUserId = user.id;
  } catch (err) {
    if (err instanceof SetupAlreadyDoneError) {
      return new Response(JSON.stringify({ error: 'Setup already completed' }), {
        status: 410,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Someone else won the race — only one user can exist.
      return new Response(JSON.stringify({ error: 'Setup already completed' }), {
        status: 410,
        headers: { 'content-type': 'application/json' },
      });
    }
    logger.error({ event: 'setup.failed', err }, 'setup failed');
    return redirectWithError(req, 'Setup failed. Please try again.');
  }

  const session = await lucia.createSession(createdUserId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  logger.info({ event: 'setup.completed', userId: createdUserId }, 'first-run setup completed');

  return NextResponse.redirect(new URL('/admin', req.url), { status: 303 });
}

class SetupAlreadyDoneError extends Error {}
