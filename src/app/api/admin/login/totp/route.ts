/**
 * POST /api/admin/login/totp — second factor TOTP verification.
 * Called after password verification when totpEnabled=true.
 * Reads a short-lived `totp_pending` cookie that contains the userId.
 * Body: { code } or { backupCode }
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { lucia } from '@/lib/auth/lucia';
import { csrf } from '@/lib/auth/csrf';
import { decrypt } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/auth/totp';
import { consumeBackupCode } from '@/lib/auth/backup-codes';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';
import { hmac } from '@/lib/crypto';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const TOTP_PENDING_COOKIE = 'slotty_totp_pending';
const TOTP_PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

const bodySchema = z.union([
  z.object({ code: z.string().length(6).regex(/^\d{6}$/) }),
  z.object({ backupCode: z.string().min(8).max(32) }),
]);

function verifyPendingToken(token: string): { userId: string; expiresAt: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0]!, 'base64url').toString('utf8');
    const sig = parts[1]!;
    const expected = hmac(env.SLOTTY_SESSION_SECRET, payload);
    if (sig !== expected) return null;
    const parsed = JSON.parse(payload) as { userId: string; expiresAt: number };
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function handler(req: NextRequest): Promise<Response> {
  const cookieStore = cookies();
  const ip = getClientIp(req.headers);

  const pendingToken = cookieStore.get(TOTP_PENDING_COOKIE)?.value ?? null;
  if (!pendingToken) {
    return NextResponse.json({ error: 'No pending TOTP session' }, { status: 400 });
  }

  const pending = verifyPendingToken(pendingToken);
  if (!pending) {
    cookieStore.delete(TOTP_PENDING_COOKIE);
    return NextResponse.json({ error: 'TOTP session expired or invalid' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error' }, { status: 422 });
  }

  const user = await db.user.findUnique({ where: { id: pending.userId } });
  if (!user || !user.totpEnabled || !user.totpSecretEnc) {
    cookieStore.delete(TOTP_PENDING_COOKIE);
    return NextResponse.json({ error: 'TOTP not configured' }, { status: 400 });
  }

  let verified = false;

  if ('code' in parsed.data) {
    const secret = decrypt(user.totpSecretEnc);
    verified = await verifyTotpCode(secret, parsed.data.code);
  } else if ('backupCode' in parsed.data) {
    verified = await consumeBackupCode(user.id, parsed.data.backupCode);
    if (!verified) {
      await recordAudit({
        userId: user.id,
        actor: 'owner',
        action: 'login.backup_code_failed',
        ip,
        userAgent: req.headers.get('user-agent') ?? undefined,
      });
    }
  }

  if (!verified) {
    logger.warn({ event: 'auth.totp_failed', userId: user.id, ip }, 'TOTP verification failed');
    return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
  }

  // Clear the pending cookie.
  cookieStore.delete(TOTP_PENDING_COOKIE);

  // Create a real session.
  const session = await lucia.createSession(user.id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'login',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: { method: 'totp' },
  });

  logger.info({ event: 'auth.totp_login_success', userId: user.id, ip }, 'TOTP login success');

  return NextResponse.json({ success: true, redirectTo: '/admin' });
}

export const POST = csrf(handler);

export { TOTP_PENDING_COOKIE, TOTP_PENDING_TTL_MS };
