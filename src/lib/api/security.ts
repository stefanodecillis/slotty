import { http } from './http';

export interface Session {
  id: string;
  fullId: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface SessionsResponse {
  data: Session[];
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordResponse {
  message?: string;
}

export interface TotpSetupResponse {
  secret: string;
  uri: string;
}

export interface TotpEnablePayload {
  secret: string;
  code: string;
}

export interface TotpEnableResponse {
  backupCodes?: string[];
}

export interface TotpDisablePayload {
  password: string;
}

export const securityKeys = {
  all: ['security'] as const,
  sessions: () => [...securityKeys.all, 'sessions'] as const,
};

export function listSessions(): Promise<SessionsResponse> {
  return http<SessionsResponse>('/api/admin/security/sessions');
}

export function revokeOtherSessions(): Promise<unknown> {
  return http('/api/admin/security/sessions', { method: 'DELETE' });
}

export function changePassword(payload: ChangePasswordPayload): Promise<ChangePasswordResponse> {
  return http<ChangePasswordResponse>('/api/admin/security/password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function setupTotp(): Promise<TotpSetupResponse> {
  return http<TotpSetupResponse>('/api/admin/security/totp/setup', { method: 'POST' });
}

export function enableTotp(payload: TotpEnablePayload): Promise<TotpEnableResponse> {
  return http<TotpEnableResponse>('/api/admin/security/totp/enable', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function disableTotp(payload: TotpDisablePayload): Promise<unknown> {
  return http('/api/admin/security/totp/disable', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
