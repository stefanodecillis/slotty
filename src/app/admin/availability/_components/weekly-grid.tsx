'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useSnackbar } from '@/components/ui/Snackbar';

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
    <div className="flex items-center gap-3">
      <input
        type="time"
        value={minutesToTime(rule.startMinute)}
        onChange={(e) => onChange(index, 'startMinute', timeToMinutes(e.target.value))}
        className="rounded-shape-xs border border-outline bg-transparent px-3 py-2 text-body-m text-on-surface outline-none focus:border-primary focus:border-2"
        step={900}
      />
      <span className="text-body-m text-on-surface-variant">to</span>
      <input
        type="time"
        value={minutesToTime(rule.endMinute)}
        onChange={(e) => onChange(index, 'endMinute', timeToMinutes(e.target.value))}
        className="rounded-shape-xs border border-outline bg-transparent px-3 py-2 text-body-m text-on-surface outline-none focus:border-primary focus:border-2"
        step={900}
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label="Remove time range"
        className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/[0.08] transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}

export function WeeklyGrid({ scheduleId, initialRules }: WeeklyGridProps) {
  const [rules, setRules] = useState<RuleData[]>(initialRules);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const { show } = useSnackbar();

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

  const handleSave = async () => {
    const error = validateRules(rules);
    if (error) {
      setValidationError(error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/availability/rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduleId, rules }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: unknown };
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save');
      }

      show({ message: 'Schedule saved successfully' });
    } catch (err) {
      show({ message: err instanceof Error ? err.message : 'Failed to save schedule' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {WEEKDAY_LABELS.map((label, weekday) => {
        const dayRules = rules
          .map((r, i) => ({ ...r, index: i }))
          .filter((r) => r.weekday === weekday);

        return (
          <div key={weekday} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="w-28 text-body-m font-medium text-on-surface">{label}</span>
              <div className="flex flex-1 flex-col gap-2">
                {dayRules.length === 0 ? (
                  <span className="text-body-m text-on-surface-variant">Unavailable</span>
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
                className="ml-4 flex h-8 w-8 items-center justify-center rounded-full text-primary hover:bg-primary/[0.08] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
              </button>
            </div>
          </div>
        );
      })}

      {validationError && (
        <p className="text-body-s text-error" role="alert">
          {validationError}
        </p>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} loading={saving} variant="filled">
          Save changes
        </Button>
      </div>
    </div>
  );
}
