import { http } from './http';

export type CalendarToggleField = 'isBusySource' | 'isDestinationEligible';

export interface CalendarTogglePayload {
  calendarId: string;
  field: CalendarToggleField;
  value: boolean;
}

export const calendarKeys = {
  all: ['calendars'] as const,
  list: () => [...calendarKeys.all, 'list'] as const,
};

export function toggleCalendar(payload: CalendarTogglePayload): Promise<unknown> {
  return http('/api/admin/calendars/toggle', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function disconnectCalendarAccount(accountId: string): Promise<unknown> {
  return http('/api/admin/calendars/disconnect', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}

export function resyncCalendarAccount(accountId: string): Promise<unknown> {
  return http('/api/admin/calendars/resync', {
    method: 'POST',
    body: JSON.stringify({ accountId }),
  });
}
