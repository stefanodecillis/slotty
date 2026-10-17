'use client';

import { useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { SettingsActionResult } from '../actions';
import { updatePublicPageSettings } from './actions';

interface PublicPageFormProps {
  settings: {
    publicPageShowName: boolean;
    publicPageShowAvatar: boolean;
    publicPageShowBio: boolean;
  };
}

const INITIAL_STATE: SettingsActionResult = { success: false };
const VISIBILITY_OPTIONS = [
  {
    field: 'publicPageShowName',
    label: 'Show my name',
    description: 'Use your profile display name on the homepage.',
  },
  {
    field: 'publicPageShowAvatar',
    label: 'Show my profile photo',
    description: 'Display your uploaded profile photo on the homepage.',
  },
  {
    field: 'publicPageShowBio',
    label: 'Show my bio',
    description: 'Include the introduction from your profile.',
  },
] as const;

export function PublicPageForm({ settings }: PublicPageFormProps) {
  const [values, setValues] = useState(settings);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    for (const { field } of VISIBILITY_OPTIONS) {
      formData.set(field, String(values[field]));
    }
    setError(undefined);
    startTransition(async () => {
      const result = await updatePublicPageSettings(INITIAL_STATE, formData);
      if (result.success) {
        toast.success('Public page settings saved.');
      } else {
        setError(result.error);
        toast.error(result.error ?? 'Failed to save public page settings.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {VISIBILITY_OPTIONS.map(({ field, label, description }) => (
          <div key={field} className="flex items-center justify-between gap-5 p-5 sm:p-6">
            <div className="grid gap-1.5">
              <Label htmlFor={field} className="text-sm font-medium">{label}</Label>
              <p id={`${field}-description`} className="text-sm text-muted-foreground">
                {description}
              </p>
            </div>
            <Switch
              id={field}
              name={field}
              checked={values[field]}
              onCheckedChange={(checked) => setValues((current) => ({ ...current, [field]: checked }))}
              disabled={isPending}
              aria-describedby={`${field}-description`}
            />
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Edit your name, photo, and bio in{' '}
        <Link href="/admin/profile" className="text-primary underline-offset-4 hover:underline">
          Profile
        </Link>.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
