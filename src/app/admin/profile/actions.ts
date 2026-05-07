'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { validateOrigin } from '@/lib/auth/csrf';
import { logger } from '@/lib/logger';

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(100),
  email: z.string().trim().email('Invalid email').max(255),
  bio: z.string().max(1000, 'Bio must be 1000 characters or fewer').optional().default(''),
  timezone: z.string().min(1),
});

export interface ProfileActionResult {
  success: boolean;
  error?: string;
}

export async function updateProfile(
  _prevState: ProfileActionResult,
  formData: FormData,
): Promise<ProfileActionResult> {
  // CSRF: read origin from request headers
  const headersList = headers();
  const origin = headersList.get('origin');
  const referer = headersList.get('referer');

  // Build a minimal Request-like object for validateOrigin
  const fakeRequest = new Request('http://localhost', {
    method: 'POST',
    headers: {
      origin: origin ?? '',
      referer: referer ?? '',
    },
  });

  if (!validateOrigin(fakeRequest)) {
    return { success: false, error: 'Forbidden' };
  }

  const user = await requireUserOrRedirect();

  const parsed = profileSchema.safeParse({
    displayName: formData.get('displayName')?.toString() ?? '',
    email: formData.get('email')?.toString() ?? '',
    bio: formData.get('bio')?.toString() ?? '',
    timezone: formData.get('timezone')?.toString() ?? '',
  });

  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return { success: false, error: first?.message ?? 'Validation error' };
  }

  try {
    await db.user.update({
      where: { id: user.id },
      data: {
        displayName: parsed.data.displayName,
        email: parsed.data.email,
        bio: parsed.data.bio ?? '',
        timezone: parsed.data.timezone,
      },
    });

    logger.info({ event: 'profile.updated', userId: user.id }, 'profile updated');
    revalidatePath('/admin/profile');
    return { success: true };
  } catch (err) {
    logger.error({ event: 'profile.update_error', userId: user.id, err }, 'profile update failed');
    return { success: false, error: 'Failed to update profile. Please try again.' };
  }
}
