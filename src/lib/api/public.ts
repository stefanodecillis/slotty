import { http } from './http';
import type { SlotResult } from '@/lib/scheduling/compute-types';

export interface SlotsQueryArgs {
  slug: string;
  /** ISO instant for inclusive lower bound. */
  fromIso: string;
  /** ISO instant for exclusive upper bound. */
  toIso: string;
  /** Booker IANA timezone, used as part of the cache key. */
  tz: string;
}

export interface CreateBookingPayload {
  eventTypeSlug: string;
  startAt: string;
  bookerName: string;
  bookerEmail: string;
  bookerTimezone: string;
  additionalGuests: string[];
  notes: string;
  answers: Record<string, string>;
  clientRequestId: string;
  password?: string;
}

export interface CreateBookingResponse {
  manageUrl?: string;
  id?: string;
}

export interface CancelBookingPayload {
  bookingId: string;
  token: string;
  reason?: string;
}

export interface RescheduleBookingPayload {
  bookingId: string;
  token: string;
  startAt: string;
}

export const publicKeys = {
  all: ['public'] as const,
  slots: (args: SlotsQueryArgs) =>
    [...publicKeys.all, 'slots', args.slug, args.tz, args.fromIso, args.toIso] as const,
};

export function getSlots({ slug, fromIso, toIso, tz }: SlotsQueryArgs): Promise<SlotResult> {
  const url = new URL(`/api/public/event-types/${slug}/slots`, window.location.origin);
  url.searchParams.set('from', fromIso);
  url.searchParams.set('to', toIso);
  url.searchParams.set('tz', tz);
  return http<SlotResult>(url.toString());
}

export function createBooking(payload: CreateBookingPayload): Promise<CreateBookingResponse> {
  return http<CreateBookingResponse>('/api/public/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function cancelBookingPublic(payload: CancelBookingPayload): Promise<unknown> {
  return http(
    `/api/public/bookings/${payload.bookingId}/cancel?t=${encodeURIComponent(payload.token)}`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: payload.reason }),
    },
  );
}

export function rescheduleBookingPublic(payload: RescheduleBookingPayload): Promise<unknown> {
  return http(
    `/api/public/bookings/${payload.bookingId}/reschedule?t=${encodeURIComponent(payload.token)}`,
    {
      method: 'POST',
      body: JSON.stringify({ startAt: payload.startAt }),
    },
  );
}
