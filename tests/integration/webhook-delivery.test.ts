/**
 * Webhook delivery integration tests.
 * Uses spyOn to mock fetch and test the full delivery pipeline.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { enqueueWebhookDelivery, registerWebhookDeliveryHandler } from '@/lib/webhooks/deliver';
import { registerHandler, runJobNow, enqueueJob, _resetForTests } from '@/lib/jobs/scheduler';

// Register the handler.
registerWebhookDeliveryHandler();

async function createUser() {
  return db.user.create({
    data: {
      username: `delivery-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      passwordHash: 'hash',
      email: `delivery-${Date.now()}@test.com`,
      displayName: 'Delivery Test',
    },
  });
}

async function createEndpoint(userId: string, active = true) {
  return db.webhookEndpoint.create({
    data: {
      userId,
      url: 'https://example.com/webhook',
      secretEnc: encrypt('test-secret-123'),
      eventTypesJson: JSON.stringify(['booking.created']),
      active,
    },
  });
}

async function cleanupUser(userId: string) {
  await db.webhookDelivery.deleteMany({
    where: { endpoint: { userId } },
  });
  await db.webhookEndpoint.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
}

describe('webhook delivery pipeline', () => {
  let userId: string;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    _resetForTests();
    registerWebhookDeliveryHandler();
    const user = await createUser();
    userId = user.id;
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    await cleanupUser(userId);
    _resetForTests();
  });

  it('delivers successfully when endpoint returns 2xx', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 }),
    );

    const endpoint = await createEndpoint(userId);
    const payload = {
      id: 'test-payload-id',
      event: 'booking.created' as const,
      timestamp: Math.floor(Date.now() / 1000),
      data: { bookingId: 'b123' },
    };

    const deliveryId = await enqueueWebhookDelivery(endpoint.id, 'booking.created', payload);

    // Find and run the job.
    const job = await db.job.findFirst({
      where: { kind: 'webhook_delivery', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    expect(job).toBeTruthy();
    await runJobNow(job!.id);

    const delivery = await db.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).toBe('delivered');
    expect(delivery?.responseCode).toBe(200);
    expect(delivery?.attempts).toBe(1);

    // Verify the request had the correct headers.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe('https://example.com/webhook');
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers['x-slotty-signature']).toBeTruthy();
    expect(headers['x-slotty-signature']).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
  });

  it('marks delivery failed and schedules retry on 5xx response', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    );

    const endpoint = await createEndpoint(userId);
    const payload = {
      id: 'retry-payload-id',
      event: 'booking.created' as const,
      timestamp: Math.floor(Date.now() / 1000),
      data: { bookingId: 'b456' },
    };

    await enqueueWebhookDelivery(endpoint.id, 'booking.created', payload);

    const job = await db.job.findFirst({
      where: { kind: 'webhook_delivery', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    await runJobNow(job!.id);

    // After first failure, delivery should be pending (retry scheduled).
    const deliveries = await db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    const delivery = deliveries[0]!;
    expect(delivery.status).toBe('pending');
    expect(delivery.attempts).toBe(1);
    expect(delivery.responseCode).toBe(500);
    expect(delivery.lastError).toBeTruthy();
    expect(delivery.nextRetryAt).toBeTruthy();
  });

  it('marks delivery permanently failed after 5 attempts', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Error', { status: 503 }),
    );

    const endpoint = await createEndpoint(userId);
    const payload = {
      id: 'perm-fail-id',
      event: 'booking.created' as const,
      timestamp: Math.floor(Date.now() / 1000),
      data: { bookingId: 'b789' },
    };

    await enqueueWebhookDelivery(endpoint.id, 'booking.created', payload);

    // Simulate 5 delivery attempts.
    for (let i = 0; i < 5; i++) {
      const deliveries = await db.webhookDelivery.findMany({
        where: { endpointId: endpoint.id },
      });
      const currentDelivery = deliveries[0]!;

      if (currentDelivery.status === 'failed') break;

      // Reset delivery attempts counter to simulate it being picked up again.
      // In real usage, the retry job handles this. Here we simulate it manually.
      await db.webhookDelivery.update({
        where: { id: currentDelivery.id },
        data: { attempts: i }, // will be incremented in processDelivery
      });

      const job = await enqueueJob('webhook_delivery', { deliveryId: currentDelivery.id });
      await runJobNow(job);
    }

    const deliveries = await db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    const delivery = deliveries[0]!;
    expect(delivery.status).toBe('failed');
  });

  it('skips delivery for inactive endpoint', async () => {
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 }),
    );

    const endpoint = await createEndpoint(userId, false); // inactive
    const payload = {
      id: 'inactive-payload',
      event: 'booking.created' as const,
      timestamp: Math.floor(Date.now() / 1000),
      data: {},
    };

    await enqueueWebhookDelivery(endpoint.id, 'booking.created', payload);

    const job = await db.job.findFirst({
      where: { kind: 'webhook_delivery', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    await runJobNow(job!.id);

    // Fetch should NOT have been called.
    expect(fetchSpy).not.toHaveBeenCalled();

    const deliveries = await db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(deliveries[0]!.status).toBe('failed');
    expect(deliveries[0]!.lastError).toContain('inactive');
  });
});
