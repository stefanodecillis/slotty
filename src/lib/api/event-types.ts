import { http } from './http';

// ─────────────────────────────────────────────────────────────
// Types — match the existing API contract (do not reshape)
// ─────────────────────────────────────────────────────────────

export interface EventTypeListItem {
  id: string;
  title: string;
  slug: string;
  durationMinutes: number;
  color: string;
  hidden: boolean;
  archived: boolean;
  destinationCalendar: { name: string } | null;
}

export interface EventTypeQuestionPayload {
  id?: string;
  label: string;
  helperText?: string;
  kind: string;
  required: boolean;
  optionsJson?: string;
  position: number;
}

export interface EventTypeUpsertPayload {
  title: string;
  slug: string;
  descriptionMd: string | null;
  color: string;
  hidden: boolean;
  durationMinutes: number;
  locationKind: string;
  locationValue: string | null;
  destinationAccountId: string;
  destinationCalendarId: string;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  bookingWindowDays: number;
  maxPerDay: number | null;
  maxPerWeek: number | null;
  maxGuests: number;
  slotIntervalMin: number;
  scheduleId: string | null;
  confirmationMd: string | null;
  redirectUrl: string | null;
  password: string | null;
  sendReminders: boolean;
  questions: EventTypeQuestionPayload[];
}

// ─────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────

export const eventTypeKeys = {
  all: ['eventTypes'] as const,
  list: () => [...eventTypeKeys.all, 'list'] as const,
  detail: (id: string) => [...eventTypeKeys.all, 'detail', id] as const,
};

// ─────────────────────────────────────────────────────────────
// Operations
// ─────────────────────────────────────────────────────────────

export function createEventType(payload: EventTypeUpsertPayload): Promise<unknown> {
  return http('/api/admin/event-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateEventType(id: string, payload: EventTypeUpsertPayload): Promise<unknown> {
  return http(`/api/admin/event-types/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function duplicateEventType(id: string): Promise<unknown> {
  return http(`/api/admin/event-types/${id}/duplicate`, { method: 'POST' });
}

export function archiveEventType(id: string, archived: boolean): Promise<unknown> {
  return http(`/api/admin/event-types/${id}/archive`, {
    method: 'POST',
    body: JSON.stringify({ archived }),
  });
}

export function deleteEventType(id: string): Promise<unknown> {
  return http(`/api/admin/event-types/${id}`, { method: 'DELETE' });
}

export function reorderEventTypes(ids: string[]): Promise<unknown> {
  return http('/api/admin/event-types/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
}
