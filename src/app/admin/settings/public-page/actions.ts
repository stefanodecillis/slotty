'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { validateOrigin } from '@/lib/auth/csrf';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { SettingsActionResult } from '../actions';

const visibilityValue = z.enum(['true', 'false']).transform((value) => value === 'true');
const publicPageSchema = z.object({
  publicPageShowName: visibilityValue,
  publicPageShowAvatar: visibilityValue,
  publicPageShowBio: visibilityValue,
});

export async function updatePublicPageSettings(
  _prevState: SettingsActionResult,
  formData: FormData,
): Promise<SettingsActionResult> {
  const headersList = headers();
  const request = new Request('http://localhost', {
    method: 'POST',
    headers: {
      origin: headersList.get('origin') ?? '',
      referer: headersList.get('referer') ?? '',
    },
  });
  if (!validateOrigin(request)) {
    return { success: false, error: 'Forbidden' };
  }

  const user = await requireUserOrRedirect();
  const parsed = publicPageSchema.safeParse({
    publicPageShowName: formData.get('publicPageShowName'),
    publicPageShowAvatar: formData.get('publicPageShowAvatar'),
    publicPageShowBio: formData.get('publicPageShowBio'),
  });
  if (!parsed.success) {
    return { success: false, error: 'Choose whether to show each profile detail.' };
  }

  try {
    await db.user.update({
      where: { id: user.id },
      data: parsed.data,
    });
    logger.info({ event: 'settings.public_page_updated', userId: user.id }, 'public page settings updated');
    revalidatePath('/');
    revalidatePath('/admin/settings/public-page');
    return { success: true };
  } catch (err) {
    logger.error(
      { event: 'settings.public_page_update_error', userId: user.id, err },
      'public page settings update failed',
    );
    return { success: false, error: 'Failed to save public page settings. Please try again.' };
  }
}
