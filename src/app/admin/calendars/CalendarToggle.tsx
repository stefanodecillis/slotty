'use client';

import { useState, useTransition } from 'react';

import { Switch } from '@/components/ui/Switch';

interface Props {
  calendarId: string;
  field: 'isBusySource' | 'isDestinationEligible';
  initialValue: boolean;
  label: string;
}

export function CalendarToggle({ calendarId, field, initialValue, label }: Props) {
  const [checked, setChecked] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const onChange = (next: boolean) => {
    const previous = checked;
    setChecked(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/calendars/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ calendarId, field, value: next }),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
      } catch (err) {
        setChecked(previous);
        setError('save failed');
      }
    });
  };

  return (
    <label className="flex items-center gap-3">
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
      <span className="text-body-m text-on-surface">{label}</span>
      {error ? <span className="text-label-s text-error">{error}</span> : null}
    </label>
  );
}
