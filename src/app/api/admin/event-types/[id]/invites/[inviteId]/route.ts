/**
 * DELETE /api/admin/event-types/[id]/invites/[inviteId]
 *
 * Revoke a one-time invite. Soft delete — sets `revokedAt = now()` rather
 * than removing the row, so the audit trail (note, createdAt, who used it)
 * stays available. Idempotent: revoking an already-revoked invite returns 200.
 *
 * Already-used invites can still be "revoked" (it's a no-op visually since
 * `used` already prevents reuse), but it's harmless. We leave that to the UI.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; inviteId: string } };

async function deleteHandler(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  const invite = await db.bookingInvite.findUnique({
    where: { id: params.inviteId },
    select: {
      id: true,
      revokedAt: true,
      eventTypeId: true,
      eventType: { select: { id: true, userId: true } },
    },
  });
  // Cross-check both the URL's event-type id and the user owning it. The
  // double check costs nothing and prevents a tampered URL from acting on
  // an invite belonging to a different event type.
  if (!invite || invite.eventTypeId !== params.id || invite.eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (invite.revokedAt) {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }

  await db.bookingInvite.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

export const DELETE = csrf(deleteHandler);
