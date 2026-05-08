import { http } from './http';

export interface RuleDataPayload {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface OverridePayload {
  scheduleId: string;
  date: string;
  isBlocked: boolean;
  startMinute?: number;
  endMinute?: number;
  label?: string;
}

export interface OverrideRecord {
  id: string;
  date: string;
  isBlocked: boolean;
  startMinute: number | null;
  endMinute: number | null;
  source: string;
  label: string | null;
}

export interface HolidayImportPayload {
  scheduleId: string;
  icalUrl: string;
  year: number;
}

export interface HolidayImportResult {
  imported?: number;
  skipped?: number;
}

export const availabilityKeys = {
  all: ['availability'] as const,
  schedule: (id: string) => [...availabilityKeys.all, 'schedule', id] as const,
};

export function saveScheduleRules(scheduleId: string, rules: RuleDataPayload[]): Promise<unknown> {
  return http('/api/admin/availability/rules', {
    method: 'PUT',
    body: JSON.stringify({ scheduleId, rules }),
  });
}

export function upsertOverride(payload: OverridePayload): Promise<{ override: OverrideRecord }> {
  return http<{ override: OverrideRecord }>('/api/admin/availability/overrides', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteOverride(scheduleId: string, date: string): Promise<unknown> {
  return http('/api/admin/availability/overrides', {
    method: 'DELETE',
    body: JSON.stringify({ scheduleId, date }),
  });
}

export function importHolidays(payload: HolidayImportPayload): Promise<HolidayImportResult> {
  return http<HolidayImportResult>('/api/admin/availability/holidays/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
