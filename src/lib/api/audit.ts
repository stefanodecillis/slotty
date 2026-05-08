import { http } from './http';

export interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  actor: string | null;
  detailsJson: string | null;
}

export interface AuditListResponse {
  data: AuditEntry[];
}

export const auditKeys = {
  all: ['audit'] as const,
  list: (filters?: Record<string, unknown>) => [...auditKeys.all, 'list', filters] as const,
};

export function listAudit(): Promise<AuditListResponse> {
  return http<AuditListResponse>('/api/admin/audit');
}
