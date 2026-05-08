'use client';

import React, { useState, useCallback } from 'react';
import { DateTime } from 'luxon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils/cn';

export interface OverrideData {
  id: string;
  date: string; // ISO date string YYYY-MM-DD
  isBlocked: boolean;
  startMinute: number | null;
  endMinute: number | null;
  source: string;
  label: string | null;
}

interface OverridesCalendarProps {
  scheduleId: string;
  initialOverrides: OverrideData[];
  timezone: string;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface DayDialogProps {
  open: boolean;
  date: string | null;
  existing: OverrideData | null;
  onClose: () => void;
  onSave: (date: string, data: { isBlocked: boolean; startMinute?: number; endMinute?: number; label?: string }) => Promise<void>;
  onRemove: (date: string) => Promise<void>;
}

function DayDialog({ open, date, existing, onClose, onSave, onRemove }: DayDialogProps) {
  const [mode, setMode] = useState<'block' | 'custom'>('block');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayDate = date
    ? DateTime.fromISO(date).toLocaleString({ month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const handleSave = async () => {
    if (!date) return;
    setError(null);

    if (mode === 'custom') {
      const start = timeToMinutes(startTime);
      const end = timeToMinutes(endTime);
      if (end <= start) {
        setError('End time must be after start time');
        return;
      }
    }

    setSaving(true);
    try {
      if (mode === 'block') {
        await onSave(date, { isBlocked: true });
      } else {
        await onSave(date, {
          isBlocked: false,
          startMinute: timeToMinutes(startTime),
          endMinute: timeToMinutes(endTime),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!date) return;
    setSaving(true);
    try {
      await onRemove(date);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{displayDate}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {existing?.source === 'holiday-import' && existing.label && (
            <p className="rounded-sm bg-secondary px-4 py-3 text-sm text-secondary-foreground">
              Holiday: {existing.label}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setMode('block')}
              className={cn(
                'flex-1 rounded-sm border px-4 py-3 text-sm transition-colors',
                mode === 'block'
                  ? 'border-primary bg-primary/[0.08] text-primary'
                  : 'border-input text-foreground hover:bg-muted/50',
              )}
            >
              Block date
            </button>
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={cn(
                'flex-1 rounded-sm border px-4 py-3 text-sm transition-colors',
                mode === 'custom'
                  ? 'border-primary bg-primary/[0.08] text-primary'
                  : 'border-input text-foreground hover:bg-muted/50',
              )}
            >
              Custom hours
            </button>
          </div>

          {mode === 'custom' && (
            <div className="flex items-center gap-3">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-sm border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-2 focus:border-primary"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-sm border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-2 focus:border-primary"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-2">
          {existing && (
            <Button variant="ghost" onClick={handleRemove} disabled={saving} className="mr-auto">
              Remove override
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OverridesCalendar({
  scheduleId,
  initialOverrides,
  timezone,
}: OverridesCalendarProps) {
  const [overrides, setOverrides] = useState<Map<string, OverrideData>>(() => {
    const map = new Map<string, OverrideData>();
    for (const ov of initialOverrides) {
      map.set(ov.date, ov);
    }
    return map;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Build 3-month grid (current + next 2)
  const now = DateTime.now().setZone(timezone);
  const months = [now, now.plus({ months: 1 }), now.plus({ months: 2 })];

  const handleDayClick = useCallback((dateStr: string) => {
    setSelectedDate(dateStr);
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(
    async (
      date: string,
      data: { isBlocked: boolean; startMinute?: number; endMinute?: number },
    ) => {
      const res = await fetch('/api/admin/availability/overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduleId, date, ...data }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: unknown };
        throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
      }

      const json = (await res.json()) as { override: OverrideData };
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(date, json.override);
        return next;
      });
      toast.success('Override saved');
    },
    [scheduleId],
  );

  const handleRemove = useCallback(
    async (date: string) => {
      const res = await fetch('/api/admin/availability/overrides', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduleId, date }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: unknown };
        throw new Error(typeof json.error === 'string' ? json.error : 'Failed to remove');
      }

      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(date);
        return next;
      });
      toast.success('Override removed');
    },
    [scheduleId],
  );

  return (
    <div className="flex flex-col gap-8">
      {months.map((monthDt) => {
        const monthStart = monthDt.startOf('month');
        const monthEnd = monthDt.endOf('month');
        const daysInMonth = monthEnd.day;
        const cells: (number | null)[] = [];

        // Fill leading empty cells (0=Sun in display)
        const firstDow = monthStart.weekday === 7 ? 0 : monthStart.weekday;
        for (let i = 0; i < firstDow; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);

        return (
          <div key={monthDt.toISO()} className="flex flex-col gap-3">
            <h3 className="text-base font-medium text-foreground">
              {monthDt.toLocaleString({ month: 'long', year: 'numeric' })}
            </h3>

            <div className="grid grid-cols-7 gap-1 text-center">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                <div key={d} className="py-1 text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}

              {cells.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} />;
                }

                const dateStr = monthDt.set({ day }).toISODate() ?? '';
                const override = overrides.get(dateStr);
                const isPast = monthDt.set({ day }) < now.startOf('day');

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => handleDayClick(dateStr)}
                    disabled={isPast}
                    className={cn(
                      'relative flex h-10 w-full items-center justify-center rounded-md text-sm transition-colors',
                      isPast
                        ? 'cursor-default text-foreground/38'
                        : 'hover:bg-muted/50 text-foreground',
                      override?.isBlocked &&
                        'bg-destructive/[0.12] text-destructive line-through hover:bg-destructive/[0.20]',
                      override && !override.isBlocked &&
                        'bg-emerald-600/[0.12] text-emerald-600 hover:bg-emerald-600/[0.20]',
                    )}
                    title={
                      override?.isBlocked
                        ? override.label ?? 'Blocked'
                        : override
                          ? `${minutesToTime(override.startMinute ?? 0)}–${minutesToTime(override.endMinute ?? 0)}`
                          : undefined
                    }
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <DayDialog
        open={dialogOpen}
        date={selectedDate}
        existing={selectedDate ? (overrides.get(selectedDate) ?? null) : null}
        onClose={() => {
          setDialogOpen(false);
          setSelectedDate(null);
        }}
        onSave={handleSave}
        onRemove={handleRemove}
      />

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs font-medium text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-destructive/[0.32]" />
          <span>Blocked</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-emerald-600/[0.32]" />
          <span>Custom hours</span>
        </div>
      </div>
    </div>
  );
}
