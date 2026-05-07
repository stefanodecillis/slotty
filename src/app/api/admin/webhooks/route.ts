/**
 * GET /api/admin/webhooks — list webhook endpoints.
 * POST /api/admin/webhooks — create a new endpoint.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const VALID_EVENTS = [
  'booking.created',
  'booking.cancelled',
  'booking.rescheduled',
  'booking.no_show',
];

const createSchema = z.object({
  url: z.string().url().max(2048),
  secret: z.string().min(8).max(512),
  events: z.array(z.string()).min(1).refine(
    (evts) => evts.every((e) => VALID_EVENTS.includes(e)),
    { message: 'Invalid event type' },
  ),
});

export async function GET(_req: NextRequest): Promise<Response> {
  const user = await requireUser();

  const endpoints = await db.webhookEndpoint.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: {
      deliveries: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, createdAt: true, responseCode: true },
      },
    },
  });

  // Strip secret from response.
  const safe = endpoints.map(({ secretEnc: _s, ...rest }) => rest);
  return NextResponse.json({ data: safe });
}

async function postHandler(req: NextRequest): Promise<Response> {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', issues: parsed.error.issues }, { status: 422 });
  }

  const { url, secret, events } = parsed.data;
  const secretEnc = encrypt(secret);

  const endpoint = await db.webhookEndpoint.create({
    data: {
      userId: user.id,
      url,
      secretEnc,
      eventTypesJson: JSON.stringify(events),
      active: true,
    },
  });

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'webhook.created',
    targetType: 'WebhookEndpoint',
    targetId: endpoint.id,
    metadata: { url, events },
  });

  const { secretEnc: _s, ...safe } = endpoint;
  return NextResponse.json({ data: safe }, { status: 201 });
}

export const POST = csrf(postHandler);
