/**
 * POST /api/admin/security/totp/enable — verify TOTP code and enable 2FA.
 * Body: { secret, code }
 * Returns raw backup codes (shown once).
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { verifyTotpCode } from '@/lib/auth/totp';
import { regenerateBackupCodes } from '@/lib/auth/backup-codes';
import { lucia } from '@/lib/auth/lucia';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  secret: z.string().min(8).max(256),
  code: z.string().length(6).regex(/^\d{6}$/),
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

  const { secret, code } = parsed.data;

  const valid = await verifyTotpCode(secret, code);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid TOTP code' }, { status: 422 });
  }

  const secretEnc = encrypt(secret);
  await db.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: secretEnc, totpEnabled: true },
  });

  const backupCodes = await regenerateBackupCodes(user.id);

  // Invalidate all sessions (user must re-auth with TOTP).
  await lucia.invalidateUserSessions(user.id);
  const blank = lucia.createBlankSessionCookie();
  cookies().set(blank.name, blank.value, blank.attributes);

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'security.totp_enabled',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.json({ success: true, backupCodes });
}

export const POST = csrf(handler);
