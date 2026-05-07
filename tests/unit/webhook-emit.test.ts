/**
 * Webhook emit unit tests.
 * Tests that emit() creates deliveries for matching events, skips inactive
 * endpoints, and maintains cross-user isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { db } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { emit } from '@/lib/webhooks/emit';

async function createUser(suffix: string) {
  return db.user.create({
    data: {
      username: `webhook-test-${suffix}`,
      passwordHash: 'hash',
      email: `webhook-${suffix}@test.com`,
      displayName: `Webhook Test ${suffix}`,
    },
  });
}

async function createEndpoint(
  userId: string,
  events: string[],
  active = true,
) {
  return db.webhookEndpoint.create({
    data: {
      userId,
      url: 'https://example.com/webhook',
      secretEnc: encrypt('test-secret'),
      eventTypesJson: JSON.stringify(events),
      active,
    },
  });
}

async function cleanupUser(userId: string) {
  await db.webhookEndpoint.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
}

describe('emit', () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createUser(Date.now().toString());
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupUser(userId);
  });

  it('creates a delivery for a subscribed event', async () => {
    const endpoint = await createEndpoint(userId, ['booking.created']);
    await emit(userId, 'booking.created', { bookingId: 'b1' });

    const deliveries = await db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0]!.event).toBe('booking.created');
  });

  it('does not create a delivery for an unsubscribed event', async () => {
    const endpoint = await createEndpoint(userId, ['booking.created']);
    await emit(userId, 'booking.cancelled', { bookingId: 'b2' });

    const deliveries = await db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(deliveries.length).toBe(0);
  });

  it('skips inactive endpoints', async () => {
    const endpoint = await createEndpoint(userId, ['booking.created'], false);
    await emit(userId, 'booking.created', { bookingId: 'b3' });

    const deliveries = await db.webhookDelivery.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(deliveries.length).toBe(0);
  });

  it('only creates deliveries for the correct user (cross-user isolation)', async () => {
    const otherUser = await createUser(`other-${Date.now()}`);

    try {
      const myEndpoint = await createEndpoint(userId, ['booking.created']);
      const otherEndpoint = await createEndpoint(otherUser.id, ['booking.created']);

      await emit(userId, 'booking.created', { bookingId: 'b4' });

      const myDeliveries = await db.webhookDelivery.findMany({
        where: { endpointId: myEndpoint.id },
      });
      const otherDeliveries = await db.webhookDelivery.findMany({
        where: { endpointId: otherEndpoint.id },
      });

      expect(myDeliveries.length).toBe(1);
      expect(otherDeliveries.length).toBe(0);
    } finally {
      await cleanupUser(otherUser.id);
    }
  });

  it('creates deliveries for multiple subscribed endpoints', async () => {
    const ep1 = await createEndpoint(userId, ['booking.created', 'booking.cancelled']);
    const ep2 = await createEndpoint(userId, ['booking.created']);
    const ep3 = await createEndpoint(userId, ['booking.cancelled']); // not subscribed to created

    await emit(userId, 'booking.created', { bookingId: 'b5' });

    const d1 = await db.webhookDelivery.findMany({ where: { endpointId: ep1.id } });
    const d2 = await db.webhookDelivery.findMany({ where: { endpointId: ep2.id } });
    const d3 = await db.webhookDelivery.findMany({ where: { endpointId: ep3.id } });

    expect(d1.length).toBe(1);
    expect(d2.length).toBe(1);
    expect(d3.length).toBe(0);
  });
});
