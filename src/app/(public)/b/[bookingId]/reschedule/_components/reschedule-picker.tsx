'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { SlotResult } from '@/lib/scheduling/compute-types';

interface Props {
  bookingId: string;
  token: string;
  slug: string;
  durationMinutes: number;
  currentStartUtc: string;
  currentBookerTz: string;
}

/**
 * Date/time picker for the reschedule flow. Mirrors the booking flow's
 * DateGrid/TimeGrid with a "Confirm new time" button at the bottom.
 */
export function ReschedulePicker({
  bookingId,
  token,
  slug,
  currentBookerTz,
}: Props) {
  const router = useRouter();

  const bookerTz = currentBookerTz;
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonthLocal(new Date()));
  const [slotsByDay, setSlotsByDay] = useState<Map<string, SlotResult['days'][number]['slots']>>(
    new Map(),
  );
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ startUtc: string; label: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingSlots(true);
      const fromDate = new Date(monthAnchor);
      const toDate = new Date(monthAnchor);
      toDate.setMonth(toDate.getMonth() + 1);

      const url = new URL(`/api/public/event-types/${slug}/slots`, window.location.origin);
      url.searchParams.set('from', fromDate.toISOString());
      url.searchParams.set('to', toDate.toISOString());
      url.searchParams.set('tz', bookerTz);

      try {
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SlotResult = await res.json();
        if (cancelled) return;
        const map = new Map<string, SlotResult['days'][number]['slots']>();
        for (const d of data.days) map.set(d.date, d.slots);
        setSlotsByDay(map);
      } catch {
        if (!cancelled) {
          toast.error('Could not load slots. Please try again.');
          setSlotsByDay(new Map());
        }
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug, bookerTz, monthAnchor]);

  const monthGrid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  async function handleSubmit() {
    if (!selectedSlot) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/bookings/${bookingId}/reschedule?t=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startAt: selectedSlot.startUtc }),
        },
      );
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'That slot is no longer available.');
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success('Booking rescheduled.');
      router.push(`/b/${bookingId}?t=${encodeURIComponent(token)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reschedule failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Calendar */}
      <div className="rounded-2xl border border-border/60 bg-muted/50 p-5">
        <DateGrid
          monthAnchor={monthAnchor}
          grid={monthGrid}
          slotsByDay={slotsByDay}
          loading={loadingSlots}
          onPrev={() => setMonthAnchor(addMonths(monthAnchor, -1))}
          onNext={() => setMonthAnchor(addMonths(monthAnchor, 1))}
          onPick={(k) => {
            setSelectedDate(k);
            setSelectedSlot(null);
          }}
        />
      </div>

      {/* Time slots */}
      {selectedDate && (
        <div className="rounded-2xl border border-border/60 bg-muted/50 p-5">
          <p className="mb-3 text-xs text-muted-foreground">
            Times on {formatHumanDate(selectedDate, bookerTz)}
          </p>
          <TimeGrid
            slots={slotsByDay.get(selectedDate) ?? []}
            selectedStartUtc={selectedSlot?.startUtc ?? null}
            onPick={(s) => setSelectedSlot({ startUtc: s.startUtc, label: s.startInBookerTz })}
          />
        </div>
      )}

      {/* Selected time chip */}
      {selectedSlot && (
        <div className="rounded-md bg-primary/10 px-4 py-3">
          <p className="text-sm font-medium text-primary">
            New time: {selectedSlot.label}
          </p>
          {selectedDate && (
            <p className="mt-0.5 text-xs text-primary">
              {formatHumanDate(selectedDate, bookerTz)}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          type="button"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Back
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={!selectedSlot || submitting}
          onClick={handleSubmit}
        >
          {submitting ? 'Confirming…' : 'Confirm new time'}
        </Button>
      </div>
    </div>
  );
}

// ───────── helpers ─────────

function startOfMonthLocal(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildMonthGrid(anchor: Date): { date: Date; key: string; inMonth: boolean }[] {
  const first = startOfMonthLocal(anchor);
  const offset = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  const cells: { date: Date; key: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push({
      date: d,
      key: isoDateLocal(d),
      inMonth: d.getMonth() === anchor.getMonth(),
    });
  }
  return cells;
}

function formatHumanDate(dateKey: string, _tz: string): string {
  const [y, m, d] = dateKey.split('-').map((s) => Number(s));
  if (!y || !m || !d) return dateKey;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ───────── DateGrid ─────────

function DateGrid({
  monthAnchor,
  grid,
  slotsByDay,
  loading,
  onPrev,
  onNext,
  onPick,
}: {
  monthAnchor: Date;
  grid: { date: Date; key: string; inMonth: boolean }[];
  slotsByDay: Map<string, SlotResult['days'][number]['slots']>;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPick: (k: string) => void;
}) {
  const monthLabel = monthAnchor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const today = isoDateLocal(new Date());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <span className="text-base font-medium text-foreground" aria-live="polite">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center">
        {weekdayLabels.map((w) => (
          <div key={w} className="py-1 text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
      </div>

      <div className={`grid grid-cols-7 gap-1 transition-opacity ${loading ? 'opacity-50' : ''}`}>
        {grid.map(({ date, key, inMonth }) => {
          const slots = slotsByDay.get(key) ?? [];
          const available = slots.length > 0;
          const isPast = key < today;
          const isToday = key === today;
          const dim = !inMonth || isPast;
          const enabled = available && !isPast;

          return (
            <button
              key={key}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && onPick(key)}
              className={[
                'relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                enabled
                  ? 'cursor-pointer bg-primary/10 text-primary font-medium hover:bg-primary hover:text-primary-foreground'
                  : 'cursor-default text-muted-foreground',
                dim ? 'opacity-30' : '',
                isToday ? 'ring-1 ring-inset ring-primary' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {loading && (
        <p className="text-center text-xs text-muted-foreground" aria-live="polite">
          Loading availability...
        </p>
      )}
    </div>
  );
}

// ───────── TimeGrid ─────────

function TimeGrid({
  slots,
  selectedStartUtc,
  onPick,
}: {
  slots: SlotResult['days'][number]['slots'];
  selectedStartUtc: string | null;
  onPick: (s: SlotResult['days'][number]['slots'][number]) => void;
}) {
  if (slots.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No availability on this day.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {slots.map((s) => {
        const isSel = s.startUtc === selectedStartUtc;
        return (
          <button
            key={s.startUtc}
            type="button"
            onClick={() => onPick(s)}
            className={[
              'w-full rounded-lg border px-4 py-3 text-left text-base transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-center',
              isSel
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input text-foreground hover:border-primary hover:bg-primary/5',
            ].join(' ')}
          >
            {s.startInBookerTz}
          </button>
        );
      })}
    </div>
  );
}
