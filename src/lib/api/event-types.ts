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
  inviteOnly: boolean;
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
  hiddenGuests: string[];
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

// ─────────────────────────────────────────────────────────────
// One-time invite links
// ─────────────────────────────────────────────────────────────

export interface InviteListItem {
  id: string;
  note: string | null;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  status: 'unused' | 'used' | 'revoked' | 'expired';
  hiddenGuestsCount: number;
  usedBy: { bookingId: string; bookerEmail: string; startAt: string; status: string } | null;
}

export interface CreatedInvite {
  id: string;
  /** Raw invite token. Surfaced exactly once at creation; not retrievable later. */
  token: string;
  /** Full shareable URL. Same lifecycle as `token`. */
  url: string;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  hiddenGuestsCount: number;
}

export const inviteKeys = {
  all: ['eventTypeInvites'] as const,
  list: (eventTypeId: string) => [...inviteKeys.all, eventTypeId] as const,
};

export function listInvites(eventTypeId: string): Promise<{ invites: InviteListItem[] }> {
  return http(`/api/admin/event-types/${eventTypeId}/invites`);
}

export function createInvite(
  eventTypeId: string,
  payload: { note?: string; expiresAt?: string; hiddenGuests?: string[] } = {},
): Promise<CreatedInvite> {
  return http(`/api/admin/event-types/${eventTypeId}/invites`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function revokeInvite(eventTypeId: string, inviteId: string): Promise<unknown> {
  return http(`/api/admin/event-types/${eventTypeId}/invites/${inviteId}`, {
    method: 'DELETE',
  });
}

// ─────────────────────────────────────────────────────────────
// One-time event type — creates a hidden+inviteOnly EventType AND
// immediately mints a BookingInvite for it. The raw token is returned
// exactly once.
// ─────────────────────────────────────────────────────────────

export interface OneTimeLinkPayload {
  title: string;
  durationMinutes: number;
  destinationAccountId: string;
  destinationCalendarId: string;
  scheduleId?: string;
  hiddenGuests?: string[];
  note?: string;
  expiresAt?: string;
}

export interface OneTimeLinkResult {
  eventTypeId: string;
  slug: string;
  inviteId: string;
  /** Raw token, shown once. */
  token: string;
  /** Full shareable URL, shown once. */
  url: string;
  expiresAt: string | null;
}

export function createOneTimeLink(payload: OneTimeLinkPayload): Promise<OneTimeLinkResult> {
  return http('/api/admin/event-types/one-time', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
