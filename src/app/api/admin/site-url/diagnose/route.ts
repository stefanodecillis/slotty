import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { requireUser } from '@/lib/auth/session';
import { diagnoseSiteUrl } from '@/lib/site-url/diagnose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  await requireUser();
  const result = await diagnoseSiteUrl(headers());
  return NextResponse.json(result);
}
