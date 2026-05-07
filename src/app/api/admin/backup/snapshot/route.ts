import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { requireUser } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function walCheckpoint(dbPath: string): void {
  try {
    execFileSync('sqlite3', [dbPath, 'PRAGMA wal_checkpoint(FULL);'], { stdio: 'pipe' });
  } catch {
    // sqlite3 CLI not available — skip checkpoint.
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const root = process.cwd();
  const dbPath = join(root, 'data', 'slotty.db');

  if (!existsSync(dbPath)) {
    return NextResponse.json({ error: 'Database not found' }, { status: 500 });
  }

  walCheckpoint(dbPath);

  const timestamp = formatTimestamp(new Date());
  const destFilename = `slotty-snapshot-${timestamp}.db`;
  const tmpDir = join(root, 'data', '.tmp');

  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  const tmpPath = join(tmpDir, destFilename);

  try {
    copyFileSync(dbPath, tmpPath);

    const fileBuffer = await readFile(tmpPath);

    // Clean up tmp file after reading.
    try {
      unlinkSync(tmpPath);
    } catch {
      // Non-fatal cleanup failure.
    }

    logger.info(
      { event: 'backup.snapshot_downloaded', size: fileBuffer.length },
      'SQLite snapshot downloaded',
    );

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${destFilename}"`,
        'Content-Length': String(fileBuffer.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error({ event: 'backup.snapshot_error', err }, 'snapshot failed');
    // Clean up tmp file on error.
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 });
  }
}
