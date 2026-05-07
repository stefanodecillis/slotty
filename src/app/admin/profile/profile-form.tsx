'use client';

import React, { useTransition, useState, useCallback } from 'react';
import type { User } from 'lucia';

import { TextField } from '@/components/ui/TextField';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useSnackbar } from '@/components/ui/Snackbar';
import { updateProfile, type ProfileActionResult } from './actions';

interface ProfileFormProps {
  user: User;
  timezones: string[];
}

const INITIAL_STATE: ProfileActionResult = { success: false };

export function ProfileForm({ user, timezones }: ProfileFormProps) {
  const snackbar = useSnackbar();
  const [isPending, startTransition] = useTransition();
  const [, setLastState] = useState<ProfileActionResult>(INITIAL_STATE);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      startTransition(async () => {
        const result = await updateProfile(INITIAL_STATE, formData);
        setLastState(result);
        if (result.success) {
          snackbar.show({ message: 'Profile saved successfully.' });
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
      <TextField
        label="Display name"
        name="displayName"
        defaultValue={user.displayName}
        required
      />
      <TextField
        label="Username"
        name="username"
        defaultValue={user.username}
        disabled
        helperText="Username cannot be changed after setup."
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        defaultValue={user.email}
        required
      />
      <TextField
        label="Bio"
        name="bio"
        defaultValue={user.bio ?? ''}
        multiline
        rows={4}
        helperText="Markdown supported. Max 1000 characters."
      />
      <Select
        label="Timezone"
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

      <div className="flex justify-end">
        <Button type="submit" variant="filled" loading={isPending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}
