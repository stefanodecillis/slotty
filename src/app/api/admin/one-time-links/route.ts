/**
 * GET /api/admin/one-time-links
 *
 * Returns all *pending* one-time invite links for the current user — each
 * row is a `isOneTime` EventType paired with its single non-terminal
 * BookingInvite (not used, not revoked, not expired). Once an invite is
 * consumed / revoked / expired, the link drops out of this list and is
 * pruned after a retention window by the `prune_booking_invites` job.
 *
 * The raw token is not re-derivable (only sha256 is stored), so the
 * response intentionally excludes the URL — it was shown exactly once
 * in the create dialog.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface PendingOneTimeLink {
  eventTypeId: string;
  title: string;
  durationMinutes: number;
  color: string;
  inviteId: string;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  hiddenGuestsCount: number;
}

function parseHiddenGuestsCount(json: string | null | undefined): number {
  if (!json) return 0;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const user = await requireUser();

  const now = new Date();
  const rows = await db.eventType.findMany({
    where: {
      userId: user.id,
      isOneTime: true,
      archived: false,
      // At least one invite that's still usable.
      invites: {
        some: {
          usedAt: null,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      invites: {
        where: {
          usedAt: null,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const links: PendingOneTimeLink[] = rows
    .filter((row) => row.invites.length > 0)
    .map((row) => {
      const invite = row.invites[0]!;
      return {
        eventTypeId: row.id,
        title: row.title,
        durationMinutes: row.durationMinutes,
        color: row.color,
        inviteId: invite.id,
        note: invite.note,
        createdAt: invite.createdAt.toISOString(),
        expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
        hiddenGuestsCount: parseHiddenGuestsCount(invite.hiddenGuestsJson),
      };
    });

  return NextResponse.json({ links });
}
