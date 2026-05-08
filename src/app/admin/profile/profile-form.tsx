'use client';

import React, { useTransition, useState, useCallback } from 'react';
import type { User } from 'lucia';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { updateProfile, type ProfileActionResult } from './actions';

interface ProfileFormProps {
  user: User;
  timezones: string[];
}

const INITIAL_STATE: ProfileActionResult = { success: false };

export function ProfileForm({ user, timezones }: ProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [, setLastState] = useState<ProfileActionResult>(INITIAL_STATE);
  const [timezone, setTimezone] = useState(user.timezone);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      formData.set('timezone', timezone);
      startTransition(async () => {
        const result = await updateProfile(INITIAL_STATE, formData);
        setLastState(result);
        if (result.success) {
          toast.success('Profile saved successfully.');
        } else if (result.error) {
          toast.error(result.error);
        }
      });
    },
    [timezone],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={user.displayName}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          defaultValue={user.username}
          disabled
        />
        <p className="text-xs text-muted-foreground">Username cannot be changed after setup.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={user.email}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          name="bio"
          defaultValue={user.bio ?? ''}
          rows={4}
        />
        <p className="text-xs text-muted-foreground">Markdown supported. Max 1000 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label>Timezone</Label>
        <Select value={timezone} onValueChange={setTimezone} name="timezone" required>
          <SelectTrigger>
            <SelectValue placeholder="Select timezone..." />
          </SelectTrigger>
          <SelectContent>
            {timezones.map((tz) => (
              <SelectItem key={tz} value={tz}>{tz}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Locale</Label>
        <Select defaultValue="en" disabled>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Additional locales coming in a future release.</p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
