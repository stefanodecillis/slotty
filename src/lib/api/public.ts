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
  /**
   * One-time invite token. When set, slot fetches go through the invite-keyed
   * route (which works even for invite-only event types whose slug-keyed
   * route 404s). The token is used as the lookup key on the server.
   */
  inviteToken?: string;
}

export interface CreateBookingPayload {
  /** Either eventTypeSlug or inviteToken must be provided. */
  eventTypeSlug?: string;
  inviteToken?: string;
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
    [
      ...publicKeys.all,
      'slots',
      args.inviteToken ? `invite:${args.inviteToken}` : `slug:${args.slug}`,
      args.tz,
      args.fromIso,
      args.toIso,
    ] as const,
};

export function getSlots({ slug, fromIso, toIso, tz, inviteToken }: SlotsQueryArgs): Promise<SlotResult> {
  const path = inviteToken
    ? `/api/public/invites/${encodeURIComponent(inviteToken)}/slots`
    : `/api/public/event-types/${slug}/slots`;
  const url = new URL(path, window.location.origin);
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
