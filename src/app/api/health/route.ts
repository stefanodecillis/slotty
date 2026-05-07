import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const startedAt = Date.now();
const VERSION = process.env.npm_package_version ?? '0.1.0';

export async function GET() {
  const uptime = Math.floor((Date.now() - startedAt) / 1000);

  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    logger.warn({ err }, 'health: db check failed');
  }

  const ok = dbOk;
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      version: VERSION,
      uptime_seconds: uptime,
      checks: { database: dbOk },
    },
    { status: ok ? 200 : 503 },
  );
}
