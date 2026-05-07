/**
 * GET /api/admin/security/sessions — list sessions for current user.
 * DELETE /api/admin/security/sessions — invalidate all sessions except current.
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireUser, getCurrentSession } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db';
import { lucia } from '@/lib/auth/lucia';
import { recordAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/http/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const { session: currentSession } = await getCurrentSession();

  const sessions = await db.session.findMany({
    where: { userId: user.id },
    orderBy: { expiresAt: 'desc' },
  });

  const safe = sessions.map((s) => ({
    id: s.id.slice(0, 12) + '...',
    fullId: s.id,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSession?.id,
  }));

  return NextResponse.json({ data: safe });
}

async function deleteHandler(req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const { session: currentSession } = await getCurrentSession();
  const ip = getClientIp(req.headers);

  // Get all sessions except current.
  const allSessions = await db.session.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  const toInvalidate = allSessions
    .filter((s) => s.id !== currentSession?.id)
    .map((s) => s.id);

  for (const sessionId of toInvalidate) {
    try {
      await lucia.invalidateSession(sessionId);
    } catch {
      // Best-effort.
    }
  }

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'security.sessions_revoked',
    ip,
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: { count: toInvalidate.length },
  });

  return NextResponse.json({ success: true, revoked: toInvalidate.length });
}

export const DELETE = csrf(deleteHandler);
