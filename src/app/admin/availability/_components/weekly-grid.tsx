'use client';

import React, { useState, useCallback } from 'react';
import { X, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { availabilityKeys, saveScheduleRules } from '@/lib/api/availability';
import { publicKeys } from '@/lib/api/public';

export interface RuleData {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

interface WeeklyGridProps {
  scheduleId: string;
  initialRules: RuleData[];
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function validateRules(rules: RuleData[]): string | null {
  for (const rule of rules) {
    if (rule.endMinute <= rule.startMinute) {
      return `End time must be after start time on ${WEEKDAY_LABELS[rule.weekday]}`;
    }
  }

  // Check overlaps within same weekday
  const byWeekday = new Map<number, RuleData[]>();
  for (const rule of rules) {
    const bucket = byWeekday.get(rule.weekday) ?? [];
    bucket.push(rule);
    byWeekday.set(rule.weekday, bucket);
  }

  for (const [weekday, dayRules] of byWeekday) {
    const sorted = [...dayRules].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (!prev || !curr) continue;
      if (curr.startMinute < prev.endMinute) {
        return `Overlapping time ranges on ${WEEKDAY_LABELS[weekday]}`;
      }
    }
  }

  return null;
}

interface RuleRowProps {
  rule: RuleData;
  index: number;
  onChange: (index: number, field: 'startMinute' | 'endMinute', value: number) => void;
  onRemove: (index: number) => void;
}

function RuleRow({ rule, index, onChange, onRemove }: RuleRowProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={minutesToTime(rule.startMinute)}
        onChange={(e) => onChange(index, 'startMinute', timeToMinutes(e.target.value))}
        className="w-28 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary"
        step={900}
      />
      <span className="text-xs text-muted-foreground">to</span>
      <input
        type="time"
        value={minutesToTime(rule.endMinute)}
        onChange={(e) => onChange(index, 'endMinute', timeToMinutes(e.target.value))}
        className="w-28 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-primary"
        step={900}
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label="Remove time range"
        className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function WeeklyGrid({ scheduleId, initialRules }: WeeklyGridProps) {
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<RuleData[]>(initialRules);
  const [validationError, setValidationError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (next: RuleData[]) => saveScheduleRules(scheduleId, next),
    onSuccess: () => {
      toast.success('Schedule saved');
      void queryClient.invalidateQueries({ queryKey: availabilityKeys.all });
      // Slot computation depends on the schedule, so invalidate any cached
      // slot queries for the public booking flow.
      void queryClient.invalidateQueries({ queryKey: publicKeys.all });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save schedule');
    },
  });
  const saving = saveMutation.isPending;

  const handleChange = useCallback(
    (index: number, field: 'startMinute' | 'endMinute', value: number) => {
      setRules((prev) =>
        prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)),
      );
      setValidationError(null);
    },
    [],
  );

  const handleRemove = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
    setValidationError(null);
  }, []);

  const handleAdd = useCallback((weekday: number) => {
    setRules((prev) => [
      ...prev,
      { weekday, startMinute: 9 * 60, endMinute: 17 * 60 },
    ]);
  }, []);

  const handleSave = () => {
    const error = validateRules(rules);
    if (error) {
      setValidationError(error);
      return;
    }
    saveMutation.mutate(rules);
  };

  return (
    <div className="flex flex-col gap-1">
      {WEEKDAY_LABELS.map((label, weekday) => {
        const dayRules = rules
          .map((r, i) => ({ ...r, index: i }))
          .filter((r) => r.weekday === weekday);

        return (
          <div
            key={weekday}
            className="flex flex-col gap-3 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4"
          >
            <div className="flex shrink-0 items-center gap-2 sm:w-32 sm:pt-1.5">
              <span className="text-base font-medium text-foreground sm:hidden">{label}</span>
              <span className="hidden sm:inline text-sm font-medium text-foreground">{WEEKDAY_SHORT[weekday]}</span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {dayRules.length === 0 ? (
                <span className="text-sm text-muted-foreground py-1.5">Unavailable</span>
              ) : (
                dayRules.map(({ index, ...rule }) => (
                  <RuleRow
                    key={index}
                    rule={rule}
                    index={index}
                    onChange={handleChange}
                    onRemove={handleRemove}
                  />
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => handleAdd(weekday)}
              aria-label={`Add time range for ${label}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/[0.08] sm:mt-0.5"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        );
      })}

      {validationError && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {validationError}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
