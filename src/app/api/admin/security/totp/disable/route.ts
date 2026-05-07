/**
 * POST /api/admin/security/totp/disable — disable 2FA.
 * Body: { password }
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  password: z.string().min(1),
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

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const valid = await verifyPassword(dbUser.passwordHash, parsed.data.password);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { totpSecretEnc: null, totpEnabled: false },
  });

  // Delete all backup codes.
  await db.backupCode.deleteMany({ where: { userId: user.id } });

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'security.totp_disabled',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  return NextResponse.json({ success: true });
}

export const POST = csrf(handler);
