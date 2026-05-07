/**
 * Idempotency lookup for booking creation.
 *
 * The unique index `(eventTypeId, clientRequestId)` guards against double
 * inserts at the DB layer; this helper just exposes a typed lookup so the
 * create path can short-circuit before doing slot computation.
 */
import type { Booking } from '@prisma/client';

import { db } from '@/lib/db';

export async function findByClientRequestId(
  eventTypeId: string,
  clientRequestId: string,
): Promise<Booking | null> {
  return db.booking.findUnique({
    where: {
      eventTypeId_clientRequestId: {
        eventTypeId,
        clientRequestId,
      },
    },
  });
}
