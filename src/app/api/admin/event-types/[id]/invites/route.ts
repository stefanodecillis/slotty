/**
 * GET /api/admin/event-types/[id]/invites
 * POST /api/admin/event-types/[id]/invites
 *
 * Manage one-time booking invites for a single event type. Single-user app,
 * so ownership is just `eventType.userId === user.id`.
 *
 * The raw token is returned ONLY in the POST response (and never re-derivable
 * from the stored hash) — same hashed-token pattern used for cancel/reschedule.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { csrf } from '@/lib/auth/csrf';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/crypto';
import { getPublicUrl } from '@/lib/site-url/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

interface InviteListItem {
  id: string;
  note: string | null;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  status: 'unused' | 'used' | 'revoked' | 'expired';
  usedBy: { bookingId: string; bookerEmail: string; startAt: string; status: string } | null;
}

function deriveStatus(
  invite: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date | null },
): InviteListItem['status'] {
  if (invite.revokedAt) return 'revoked';
  if (invite.usedAt) return 'used';
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'unused';
}

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  const eventType = await db.eventType.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true },
  });
  if (!eventType || eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const invites = await db.bookingInvite.findMany({
    where: { eventTypeId: eventType.id },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
    include: {
      usedBy: {
        select: { id: true, bookerEmail: true, startAt: true, status: true },
      },
    },
  });

  const items: InviteListItem[] = invites.map((i) => ({
    id: i.id,
    note: i.note,
    createdAt: i.createdAt.toISOString(),
    usedAt: i.usedAt ? i.usedAt.toISOString() : null,
    revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
    status: deriveStatus(i),
    usedBy: i.usedBy
      ? {
          bookingId: i.usedBy.id,
          bookerEmail: i.usedBy.bookerEmail,
          startAt: i.usedBy.startAt.toISOString(),
          status: i.usedBy.status,
        }
      : null,
  }));

  return NextResponse.json({ invites: items });
}

const createSchema = z.object({
  note: z.string().trim().max(200).optional(),
  // ISO instant. Optional: enforcement deferred but the column is here.
  expiresAt: z.string().datetime().optional(),
});

async function postHandler(req: NextRequest, { params }: RouteContext): Promise<Response> {
  const user = await requireUser();

  const eventType = await db.eventType.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true },
  });
  if (!eventType || eventType.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — note and expiresAt are both optional.
  }
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation error', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { token: rawToken, hash } = generateToken(32);
  const invite = await db.bookingInvite.create({
    data: {
      eventTypeId: eventType.id,
      tokenHash: hash,
      note: parsed.data.note ?? null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  const base = await getPublicUrl();
  return NextResponse.json(
    {
      id: invite.id,
      // Only response that ever surfaces the raw token. Show it once, then
      // store nothing client-side — only the URL the admin copied.
      token: rawToken,
      url: `${base}/i/${rawToken}`,
      note: invite.note,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    },
    { status: 201 },
  );
}

export const POST = csrf(postHandler);
