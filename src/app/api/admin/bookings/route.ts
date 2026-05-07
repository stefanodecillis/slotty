/**
 * GET /api/admin/bookings — owner-only paginated list with filters.
 *
 * Filters (all optional):
 *   - status:       confirmed | cancelled | rescheduled
 *   - eventTypeId
 *   - from / to:    ISO 8601 instants on `start_at`
 *   - q:            substring match against booker_name / booker_email
 *   - cursor:       opaque pagination cursor (booking id)
 *   - limit:        default 50, max 200
 *
 * Cross-user isolation: only returns bookings whose event type belongs to the
 * authenticated user.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);

  const limitParam = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT));
  const cursor = searchParams.get('cursor');
  const status = searchParams.get('status');
  const eventTypeId = searchParams.get('eventTypeId');
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const q = searchParams.get('q');

  // Restrict event types to those owned by the requesting user. SQLite doesn't
  // support cross-table filters via Prisma's `where` for a 1-to-many root, so
  // we resolve the user's event type IDs first.
  const ownedEventTypes = await db.eventType.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, slug: true },
  });
  const ownedIds = ownedEventTypes.map((e) => e.id);
  if (ownedIds.length === 0) {
    return NextResponse.json({ bookings: [], eventTypes: [], nextCursor: null });
  }

  type BookingWhere = NonNullable<Parameters<typeof db.booking.findMany>[0]>['where'];
  const where: BookingWhere = {
    eventTypeId: eventTypeId && ownedIds.includes(eventTypeId) ? eventTypeId : { in: ownedIds },
  };
  if (status) (where as { status?: string }).status = status;
  if (fromParam || toParam) {
    (where as { startAt?: { gte?: Date; lte?: Date } }).startAt = {};
    if (fromParam) (where as { startAt: { gte?: Date } }).startAt!.gte = new Date(fromParam);
    if (toParam) (where as { startAt: { lte?: Date } }).startAt!.lte = new Date(toParam);
  }
  if (q) {
    (where as { OR?: unknown[] }).OR = [
      { bookerName: { contains: q } },
      { bookerEmail: { contains: q } },
    ];
  }

  const rows = await db.booking.findMany({
    where,
    orderBy: { startAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null;

  return NextResponse.json({
    bookings: slice.map((b) => ({
      id: b.id,
      eventTypeId: b.eventTypeId,
      startAt: b.startAt,
      endAt: b.endAt,
      status: b.status,
      bookerName: b.bookerName,
      bookerEmail: b.bookerEmail,
      bookerTimezone: b.bookerTimezone,
      meetingUrl: b.meetingUrl,
      noShow: b.noShow,
      needsSync: b.needsSync,
      createdAt: b.createdAt,
      cancelledAt: b.cancelledAt,
    })),
    eventTypes: ownedEventTypes,
    nextCursor,
  });
}
