/**
 * POST /api/admin/security/totp/setup — generate ephemeral TOTP secret.
 * Returns the secret and otpauth URI. Does NOT save to DB yet.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { generateTotpSecret, generateTotpUri } from '@/lib/auth/totp';

export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest): Promise<Response> {
  const user = await requireUser();

  const secret = generateTotpSecret();
  const uri = generateTotpUri(user.username, secret);

  return NextResponse.json({ secret, uri });
}

export const POST = csrf(handler);
