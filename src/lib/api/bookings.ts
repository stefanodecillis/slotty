import { http } from './http';

export const bookingKeys = {
  all: ['bookings'] as const,
  list: (filters?: Record<string, unknown>) => [...bookingKeys.all, 'list', filters] as const,
  detail: (id: string) => [...bookingKeys.all, 'detail', id] as const,
};

export function cancelBookingAdmin(bookingId: string, reason?: string): Promise<unknown> {
  return http(`/api/admin/bookings/${bookingId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function setBookingNoShow(bookingId: string, noShow: boolean): Promise<unknown> {
  return http(`/api/admin/bookings/${bookingId}/no-show`, {
    method: 'POST',
    body: JSON.stringify({ noShow }),
  });
}
