/**
 * PUT /api/admin/webhooks/[id] — update endpoint.
 * DELETE /api/admin/webhooks/[id] — delete endpoint.
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

const updateSchema = z.object({
  url: z.string().url().max(2048).optional(),
  secret: z.string().min(8).max(512).optional(),
  events: z
    .array(z.string())
    .min(1)
    .refine((evts) => evts.every((e) => VALID_EVENTS.includes(e)))
    .optional(),
  active: z.boolean().optional(),
});

interface RouteParams {
  params: { id: string };
}

async function putHandler(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await requireUser();

  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!endpoint) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', issues: parsed.error.issues }, { status: 422 });
  }

  const { url, secret, events, active } = parsed.data;

  const updated = await db.webhookEndpoint.update({
    where: { id: params.id },
    data: {
      ...(url !== undefined ? { url } : {}),
      ...(secret !== undefined ? { secretEnc: encrypt(secret) } : {}),
      ...(events !== undefined ? { eventTypesJson: JSON.stringify(events) } : {}),
      ...(active !== undefined ? { active } : {}),
    },
  });

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'webhook.updated',
    targetType: 'WebhookEndpoint',
    targetId: params.id,
    metadata: { url, events, active },
  });

  const { secretEnc: _s, ...safe } = updated;
  return NextResponse.json({ data: safe });
}

async function deleteHandler(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await requireUser();

  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!endpoint) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.webhookEndpoint.delete({ where: { id: params.id } });

  await recordAudit({
    userId: user.id,
    actor: 'owner',
    action: 'webhook.deleted',
    targetType: 'WebhookEndpoint',
    targetId: params.id,
  });

  return NextResponse.json({ success: true });
}

export const PUT = csrf(putHandler);
export const DELETE = csrf(deleteHandler);
