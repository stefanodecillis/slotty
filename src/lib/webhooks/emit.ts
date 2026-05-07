/**
 * Webhook event emission.
 * Finds active endpoints subscribed to the event and enqueues deliveries.
 */
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueueWebhookDelivery, type WebhookPayload } from './deliver';

export type WebhookEvent =
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.rescheduled'
  | 'booking.no_show'
  | 'webhook.test';

/**
 * Emit a webhook event to all active, subscribed endpoints for a user.
 */
export async function emit(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const endpoints = await db.webhookEndpoint.findMany({
      where: { userId, active: true },
    });

    for (const endpoint of endpoints) {
      let subscribedEvents: string[];
      try {
        subscribedEvents = JSON.parse(endpoint.eventTypesJson) as string[];
      } catch {
        subscribedEvents = [];
      }

      if (!subscribedEvents.includes(event)) continue;

      const payload: WebhookPayload = {
        id: randomBytes(16).toString('hex'),
        event,
        timestamp: Math.floor(Date.now() / 1000),
        data,
      };

      try {
        await enqueueWebhookDelivery(endpoint.id, event, payload);
      } catch (err) {
        logger.warn(
          {
            event: 'webhook.enqueue_failed',
            endpointId: endpoint.id,
            webhookEvent: event,
            err: String(err),
          },
          'failed to enqueue webhook delivery',
        );
      }
    }
  } catch (err) {
    // Best-effort: never propagate to callers.
    logger.warn(
      { event: 'webhook.emit_failed', webhookEvent: event, userId, err: String(err) },
      'webhook emit failed',
    );
  }
}
