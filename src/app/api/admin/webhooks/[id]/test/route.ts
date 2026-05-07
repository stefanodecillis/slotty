/**
 * POST /api/admin/webhooks/[id]/test — send a test event to verify the endpoint.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/session';
import { csrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db';
import { enqueueWebhookDelivery } from '@/lib/webhooks/deliver';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { id: string };
}

async function handler(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const user = await requireUser();

  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!endpoint) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const payload = {
    id: randomBytes(16).toString('hex'),
    event: 'webhook.test' as const,
    timestamp: Math.floor(Date.now() / 1000),
    data: {
      message: 'This is a test webhook delivery from Slotty.',
      endpointId: endpoint.id,
    },
  };

  const deliveryId = await enqueueWebhookDelivery(endpoint.id, 'webhook.test', payload);

  return NextResponse.json({ deliveryId, message: 'Test delivery enqueued.' });
}

export const POST = csrf(handler);
