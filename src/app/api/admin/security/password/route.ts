/**
 * POST /api/admin/security/password — change password.
 * Verifies current password, validates strength of new password, updates hash.
 * Invalidates all existing sessions for security.
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db';
import { verifyPassword, hashPassword, validatePasswordStrength } from '@/lib/auth/password';
import { lucia } from '@/lib/auth/lucia';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1).max(1024),
  confirmPassword: z.string().min(1),
});

async function handler(req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const ip = getClientIp(req.headers);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', issues: parsed.error.issues }, { status: 422 });
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match' }, { status: 422 });
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) {
    return NextResponse.json({ error: strength.reason }, { status: 422 });
  }

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const valid = await verifyPassword(dbUser.passwordHash, currentPassword);
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
  }

  const newHash = await hashPassword(newPassword);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  // Invalidate all sessions for security.
  await lucia.invalidateUserSessions(user.id);
  const blank = lucia.createBlankSessionCookie();
  cookies().set(blank.name, blank.value, blank.attributes);

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'security.password_changed',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.json({ success: true, message: 'Password updated. Please sign in again.' });
}

export const POST = csrf(handler);
