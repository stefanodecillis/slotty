'use client';

import React, { useTransition, useState, useCallback } from 'react';
import type { User } from 'lucia';

import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useSnackbar } from '@/components/ui/Snackbar';
import { updateGeneralSettings, type SettingsActionResult } from './actions';

interface GeneralFormProps {
  user: User;
  timezones: string[];
  siteUrl: string;
}

const INITIAL_STATE: SettingsActionResult = { success: false };

const WEEK_START_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
];

export function GeneralForm({ user, timezones, siteUrl }: GeneralFormProps) {
  const snackbar = useSnackbar();
  const [isPending, startTransition] = useTransition();
  const [, setLastState] = useState<SettingsActionResult>(INITIAL_STATE);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      startTransition(async () => {
        const result = await updateGeneralSettings(INITIAL_STATE, formData);
        setLastState(result);
        if (result.success) {
          snackbar.show({ message: 'General settings saved.' });
        } else if (result.error) {
          snackbar.show({ message: result.error });
        }
      });
    },
    [snackbar],
  );

  const tzOptions = timezones.map((tz) => ({ value: tz, label: tz }));

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-label-m text-on-surface-variant">Site URL</p>
        <p className="text-body-l text-on-surface font-mono bg-surface-container rounded-shape-xs px-3 py-2">
          {siteUrl}
        </p>
      </div>

      <Select
        label="Default timezone"
        name="timezone"
        defaultValue={user.timezone}
        options={tzOptions}
        searchable
        required
      />

      <Select
        label="Locale"
        name="locale"
        defaultValue="en"
        options={[{ value: 'en', label: 'English' }]}
        disabled
        helperText="Additional locales coming in a future release."
      />

      <Select
        label="Week starts on"
        name="weekStart"
        defaultValue={String(user.weekStart)}
        options={WEEK_START_OPTIONS}
      />

      <div className="flex justify-end">
        <Button type="submit" variant="filled" loading={isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
