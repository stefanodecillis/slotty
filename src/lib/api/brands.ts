import { http } from './http';
import type { BrandListItem, BrandUpsertInput } from '@/lib/brand/types';

export const brandKeys = {
  all: ['brands'] as const,
  list: () => [...brandKeys.all, 'list'] as const,
  detail: (id: string) => [...brandKeys.all, 'detail', id] as const,
};

export interface BrandDetail {
  id: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  logoPath: string | null;
  faviconPath: string | null;
  attachedEventTypes: number;
}

export function listBrands(): Promise<BrandListItem[]> {
  return http<BrandListItem[]>('/api/admin/brands');
}

export function getBrand(id: string): Promise<BrandDetail> {
  return http<BrandDetail>(`/api/admin/brands/${id}`);
}

export function createBrand(payload: BrandUpsertInput): Promise<{ id: string }> {
  return http<{ id: string }>('/api/admin/brands', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBrand(id: string, payload: BrandUpsertInput): Promise<{ id: string }> {
  return http<{ id: string }>(`/api/admin/brands/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteBrand(id: string): Promise<{ ok: true }> {
  return http<{ ok: true }>(`/api/admin/brands/${id}`, { method: 'DELETE' });
}

export function uploadBrandLogo(id: string, blob: Blob): Promise<{ logoPath: string }> {
  const formData = new FormData();
  formData.set('logo', blob, 'logo.webp');
  return http<{ logoPath: string }>(`/api/admin/brands/${id}/logo`, {
    method: 'POST',
    body: formData,
  });
}

export function uploadBrandFavicon(id: string, blob: Blob): Promise<{ faviconPath: string }> {
  const formData = new FormData();
  formData.set('favicon', blob, 'favicon.png');
  return http<{ faviconPath: string }>(`/api/admin/brands/${id}/favicon`, {
    method: 'POST',
    body: formData,
  });
}
