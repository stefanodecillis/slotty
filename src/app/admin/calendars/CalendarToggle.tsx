'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Switch } from '@/components/ui/switch';
import { calendarKeys, toggleCalendar } from '@/lib/api/calendars';
import { eventTypeKeys } from '@/lib/api/event-types';

interface Props {
  calendarId: string;
  field: 'isBusySource' | 'isDestinationEligible';
  initialValue: boolean;
  label: string;
}

export function CalendarToggle({ calendarId, field, initialValue, label }: Props) {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  // Optimistic toggle: flip immediately, revert on failure. Mirrors the
  // previous useTransition behaviour but lets TanStack manage the in-flight
  // state and cache invalidation.
  const mutation = useMutation({
    mutationFn: (next: boolean) => toggleCalendar({ calendarId, field, value: next }),
    onMutate: (next: boolean) => {
      const previous = checked;
      setChecked(next);
      setError(null);
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx) setChecked(ctx.previous);
      setError('save failed');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.all });
      // Event-type form depends on the calendar list (eligible destinations).
      void queryClient.invalidateQueries({ queryKey: eventTypeKeys.all });
    },
  });

  return (
    <div className="flex items-center gap-3 sm:flex-col-reverse sm:items-center sm:gap-1">
      <span className="text-xs font-medium text-muted-foreground sm:text-xs">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={(next) => mutation.mutate(next)}
        aria-label={label}
      />
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
