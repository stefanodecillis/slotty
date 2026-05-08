import { http } from './http';

export interface AvatarUploadResponse {
  avatarUrl?: string;
}

export const profileKeys = {
  all: ['profile'] as const,
  avatar: () => [...profileKeys.all, 'avatar'] as const,
};

export function uploadAvatar(file: File): Promise<AvatarUploadResponse> {
  const formData = new FormData();
  formData.set('avatar', file);
  return http<AvatarUploadResponse>('/api/admin/profile/avatar', {
    method: 'POST',
    body: formData,
  });
}
