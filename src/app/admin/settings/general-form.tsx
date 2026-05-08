'use client';

import React, { useTransition, useState, useCallback } from 'react';
import type { User } from 'lucia';
import { toast } from 'sonner';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { updateGeneralSettings, type SettingsActionResult } from './actions';

interface GeneralFormProps {
  user: User;
  timezones: string[];
}

const INITIAL_STATE: SettingsActionResult = { success: false };

const WEEK_START_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
];

export function GeneralForm({ user, timezones }: GeneralFormProps) {
  const [isPending, startTransition] = useTransition();
  const [, setLastState] = useState<SettingsActionResult>(INITIAL_STATE);
  const [timezone, setTimezone] = useState(user.timezone);
  const [weekStart, setWeekStart] = useState(String(user.weekStart));

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      formData.set('timezone', timezone);
      formData.set('weekStart', weekStart);
      startTransition(async () => {
        const result = await updateGeneralSettings(INITIAL_STATE, formData);
        setLastState(result);
        if (result.success) {
          toast.success('General settings saved.');
        } else if (result.error) {
          toast.error(result.error);
        }
      });
    },
    [timezone, weekStart],
  );

  const tzOptions = timezones.map((tz) => ({ value: tz, label: tz }));

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-2">
        <Label>Default timezone</Label>
        <Select value={timezone} onValueChange={setTimezone} name="timezone" required>
          <SelectTrigger>
            <SelectValue placeholder="Select timezone..." />
          </SelectTrigger>
          <SelectContent>
            {tzOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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

      <div className="grid gap-2">
        <Label>Week starts on</Label>
        <Select value={weekStart} onValueChange={setWeekStart} name="weekStart">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEK_START_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
