/**
 * Webhook delivery: enqueue + job handler.
 * Handles retry with exponential backoff up to 5 attempts.
 */
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { registerHandler, enqueueJob } from '@/lib/jobs/scheduler';
import { signPayload } from './sign';

const MAX_ATTEMPTS = 5;

// Exponential backoff delays in milliseconds: 1m, 5m, 30m, 2h, 12h
const BACKOFF_MS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
];

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/**
 * Create a WebhookDelivery row and enqueue a job for it.
 */
export async function enqueueWebhookDelivery(
  endpointId: string,
  event: string,
  payload: WebhookPayload,
): Promise<string> {
  const delivery = await db.webhookDelivery.create({
    data: {
      endpointId,
      event,
      payloadJson: JSON.stringify(payload),
      status: 'pending',
      attempts: 0,
    },
  });

  await enqueueJob('webhook_delivery', { deliveryId: delivery.id });
  return delivery.id;
}

/**
 * Register the webhook_delivery job handler.
 * Called once at startup from instrumentation.
 */
export function registerWebhookDeliveryHandler(): void {
  registerHandler(
    'webhook_delivery',
    async (rawPayload) => {
      const { deliveryId } = rawPayload as { deliveryId: string };
      await processDelivery(deliveryId);
    },
    { maxAttempts: 1, retryOnError: false }, // We manage retries ourselves
  );
}

async function processDelivery(deliveryId: string): Promise<void> {
  const delivery = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });

  if (!delivery) {
    logger.warn({ event: 'webhook.delivery_not_found', deliveryId }, 'delivery not found');
    return;
  }

  if (delivery.status === 'delivered') return;

  const { endpoint } = delivery;

  // Skip if endpoint is inactive.
  if (!endpoint.active) {
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', lastError: 'endpoint inactive' },
    });
    return;
  }

  // Increment attempts.
  const attempts = delivery.attempts + 1;
  await db.webhookDelivery.update({
    where: { id: deliveryId },
    data: { attempts },
  });

  // Decrypt secret.
  let secret: string;
  try {
    secret = decrypt(endpoint.secretEnc);
  } catch (err) {
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'failed', lastError: 'failed to decrypt secret' },
    });
    return;
  }

  const body = delivery.payloadJson;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(secret, body, timestamp);

  let responseCode: number | null = null;
  let errorMsg: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slotty-signature': signature,
        'user-agent': 'Slotty-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    responseCode = response.status;

    if (response.ok) {
      await db.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'delivered',
          responseCode,
          deliveredAt: new Date(),
          lastError: null,
        },
      });
      logger.info(
        { event: 'webhook.delivered', deliveryId, endpointId: endpoint.id, responseCode },
        'webhook delivered',
      );
      return;
    }

    errorMsg = `HTTP ${responseCode}`;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  // Delivery failed. Check if we should retry.
  if (attempts >= MAX_ATTEMPTS) {
    await db.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        responseCode: responseCode ?? null,
        lastError: errorMsg,
      },
    });
    logger.warn(
      { event: 'webhook.failed_permanently', deliveryId, attempts, errorMsg },
      'webhook delivery permanently failed',
    );
    return;
  }

  // Schedule retry.
  const backoffMs = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
  const nextRetryAt = new Date(Date.now() + backoffMs);

  await db.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'pending',
      responseCode: responseCode ?? null,
      lastError: errorMsg,
      nextRetryAt,
    },
  });

  await enqueueJob('webhook_delivery', { deliveryId }, nextRetryAt);

  logger.warn(
    { event: 'webhook.retry_scheduled', deliveryId, attempts, nextRetryAt, errorMsg },
    'webhook delivery failed, retry scheduled',
  );
}
