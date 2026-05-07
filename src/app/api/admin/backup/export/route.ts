import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Lazy import JSZip — keeps edge-bundle clean if ever needed.
  const JSZip = (await import('jszip')).default;

  const zip = new JSZip();

  // User — strip sensitive fields.
  const user = await db.user.findFirst();
  const safeUser = user
    ? {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarPath: user.avatarPath,
        bio: user.bio,
        timezone: user.timezone,
        locale: user.locale,
        theme: user.theme,
        seedColor: user.seedColor,
        weekStart: user.weekStart,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }
    : null;

  zip.file('users.json', JSON.stringify([safeUser].filter(Boolean), null, 2));

  // Phase 2: other tables are empty stubs.
  zip.file('event_types.json', JSON.stringify([], null, 2));
  zip.file('bookings.json', JSON.stringify([], null, 2));
  zip.file('audit_log.json', JSON.stringify([], null, 2));
  zip.file('connected_accounts.json', JSON.stringify([], null, 2));

  let zipBuffer: Buffer;
  try {
    zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (err) {
    logger.error({ event: 'backup.export_error', err }, 'export zip failed');
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }

  const filename = `slotty-export-${isoDate()}.zip`;

  logger.info({ event: 'backup.export_downloaded', size: zipBuffer.length }, 'data export downloaded');

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipBuffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
