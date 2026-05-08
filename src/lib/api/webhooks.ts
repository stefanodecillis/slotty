import { http } from './http';

export interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypesJson: string;
  active: boolean;
  createdAt: string;
  deliveries: Array<{ status: string; createdAt: string; responseCode: number | null }>;
}

export interface WebhookListResponse {
  data: WebhookEndpoint[];
}

export interface WebhookCreatePayload {
  url: string;
  secret: string;
  events: string[];
}

export interface WebhookUpdatePayload {
  active?: boolean;
  url?: string;
  secret?: string;
  events?: string[];
}

export const webhookKeys = {
  all: ['webhooks'] as const,
  list: () => [...webhookKeys.all, 'list'] as const,
};

export function listWebhooks(): Promise<WebhookListResponse> {
  return http<WebhookListResponse>('/api/admin/webhooks');
}

export function createWebhook(payload: WebhookCreatePayload): Promise<unknown> {
  return http('/api/admin/webhooks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateWebhook(id: string, payload: WebhookUpdatePayload): Promise<unknown> {
  return http(`/api/admin/webhooks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteWebhook(id: string): Promise<unknown> {
  return http(`/api/admin/webhooks/${id}`, { method: 'DELETE' });
}

export function testWebhook(id: string): Promise<unknown> {
  return http(`/api/admin/webhooks/${id}/test`, { method: 'POST' });
}
