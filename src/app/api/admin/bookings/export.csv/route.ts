/**
 * GET /api/admin/bookings/export.csv — owner-only CSV export.
 *
 * Accepts the same filters as the list endpoint (status, eventTypeId, from,
 * to, q). Streams a CSV with one row per booking. No pagination — the export
 * is bounded by the filter window in practice.
 *
 * Notes on CSV: we hand-write the encoder rather than pulling in a dependency
 * because the field shapes are stable. Excel-friendly: leading-quoted, comma
 * delimiter, BOM-less UTF-8.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  'id',
  'eventTypeId',
  'eventTypeTitle',
  'startAt',
  'endAt',
  'status',
  'bookerName',
  'bookerEmail',
  'bookerTimezone',
  'meetingUrl',
  'noShow',
  'needsSync',
  'createdAt',
  'cancelledAt',
  'cancelReason',
] as const;

export async function GET(req: NextRequest): Promise<Response> {
  const user = await requireUser();
  const { searchParams } = new URL(req.url);

  const status = searchParams.get('status');
  const eventTypeId = searchParams.get('eventTypeId');
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const q = searchParams.get('q');

  const ownedEventTypes = await db.eventType.findMany({
    where: { userId: user.id },
    select: { id: true, title: true },
  });
  const ownedIds = ownedEventTypes.map((e) => e.id);
  const titleById = new Map(ownedEventTypes.map((e) => [e.id, e.title]));

  if (ownedIds.length === 0) {
    return new NextResponse(`${COLUMNS.join(',')}\n`, {
      status: 200,
      headers: csvHeaders('bookings.csv'),
    });
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
    take: 5000,
  });

  const lines: string[] = [COLUMNS.join(',')];
  for (const b of rows) {
    lines.push(
      [
        b.id,
        b.eventTypeId,
        titleById.get(b.eventTypeId) ?? '',
        b.startAt,
        b.endAt,
        b.status,
        b.bookerName,
        b.bookerEmail,
        b.bookerTimezone,
        b.meetingUrl,
        b.noShow,
        b.needsSync,
        b.createdAt,
        b.cancelledAt,
        b.cancelReason,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  const csv = `${lines.join('\n')}\n`;

  const filename = `bookings-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: csvHeaders(filename),
  });
}

function csvHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  };
}
