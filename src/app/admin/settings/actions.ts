'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { validateOrigin } from '@/lib/auth/csrf';
import { logger } from '@/lib/logger';

const generalSchema = z.object({
  timezone: z.string().min(1),
  weekStart: z.coerce.number().int().min(0).max(1),
});

const brandingSchema = z.object({
  seedColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (e.g. #4F6CFF)')
    .optional()
    .default('#4F6CFF'),
  theme: z.enum(['light', 'dark', 'system']),
});

export interface SettingsActionResult {
  success: boolean;
  error?: string;
}

function buildFakeRequest(headersList: ReturnType<typeof headers>): Request {
  return new Request('http://localhost', {
    method: 'POST',
    headers: {
      origin: headersList.get('origin') ?? '',
      referer: headersList.get('referer') ?? '',
    },
  });
}

export async function updateGeneralSettings(
  _prevState: SettingsActionResult,
  formData: FormData,
): Promise<SettingsActionResult> {
  const headersList = headers();
  if (!validateOrigin(buildFakeRequest(headersList))) {
    return { success: false, error: 'Forbidden' };
  }

  const user = await requireUserOrRedirect();

  const parsed = generalSchema.safeParse({
    timezone: formData.get('timezone')?.toString() ?? '',
    weekStart: formData.get('weekStart')?.toString() ?? '1',
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Validation error' };
  }

  try {
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          timezone: parsed.data.timezone,
          timezoneSet: true,
          weekStart: parsed.data.weekStart,
        },
      }),
      db.schedule.updateMany({
        where: { userId: user.id },
        data: { timezone: parsed.data.timezone },
      }),
    ]);
    const { invalidate } = await import('@/lib/scheduling/cache');
    invalidate();

    logger.info({ event: 'settings.general_updated', userId: user.id }, 'general settings updated');
    revalidatePath('/admin/settings');
    return { success: true };
  } catch (err) {
    logger.error({ event: 'settings.general_update_error', userId: user.id, err }, 'general settings update failed');
    return { success: false, error: 'Failed to save settings. Please try again.' };
  }
}

export async function updateBrandingSettings(
  _prevState: SettingsActionResult,
  formData: FormData,
): Promise<SettingsActionResult> {
  const headersList = headers();
  if (!validateOrigin(buildFakeRequest(headersList))) {
    return { success: false, error: 'Forbidden' };
  }

  const user = await requireUserOrRedirect();

  const parsed = brandingSchema.safeParse({
    seedColor: formData.get('seedColor')?.toString() ?? '',
    theme: formData.get('theme')?.toString() ?? 'system',
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Validation error' };
  }

  try {
    await db.user.update({
      where: { id: user.id },
      data: {
        seedColor: parsed.data.seedColor,
        theme: parsed.data.theme,
      },
    });

    logger.info({ event: 'settings.branding_updated', userId: user.id }, 'branding settings updated');
    revalidatePath('/admin/settings');
    return { success: true };
  } catch (err) {
    logger.error({ event: 'settings.branding_update_error', userId: user.id, err }, 'branding settings update failed');
    return { success: false, error: 'Failed to save branding. Please try again.' };
  }
}
