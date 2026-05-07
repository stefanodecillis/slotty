'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useSnackbar } from '@/components/ui/Snackbar';
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
 * Trimmed-down version of the public booking flow's date/time picker, scoped
 * to picking a new start instant. We re-use the existing slots API. On submit
 * we POST to the reschedule endpoint and route to the booking page on success.
 */
export function ReschedulePicker({
  bookingId,
  token,
  slug,
  durationMinutes,
  currentStartUtc,
  currentBookerTz,
}: Props) {
  void durationMinutes; // displayed contextually elsewhere
  void currentStartUtc;
  const router = useRouter();
  const { show } = useSnackbar();

  const bookerTz = currentBookerTz;
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonthLocal(new Date()));
  const [slotsByDay, setSlotsByDay] = useState<Map<string, SlotResult['days'][number]['slots']>>(
    new Map(),
  );
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ startUtc: string; label: string } | null>(null);
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
          show({ message: 'Could not load slots. Please try again.' });
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
  }, [slug, bookerTz, monthAnchor, show]);

  const monthGrid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  async function handleSubmit() {
    if (!selectedSlot) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/bookings/${bookingId}/reschedule?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startAt: selectedSlot.startUtc }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        show({ message: data.error ?? 'That slot is no longer available.' });
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      show({ message: 'Booking rescheduled.' });
      router.push(`/b/${bookingId}?t=${encodeURIComponent(token)}`);
    } catch (err) {
      show({ message: err instanceof Error ? err.message : 'Reschedule failed' });
      setSubmitting(false);
    }
  }

  return (
    <Card variant="outlined">
      <Card.Header>
        <h2 className="text-title-m text-on-surface">Pick a new time</h2>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
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

        {selectedDate && (
          <div>
            <p className="mb-2 text-body-s text-on-surface-variant">Times on {selectedDate}</p>
            <TimeGrid
              slots={slotsByDay.get(selectedDate) ?? []}
              selectedStartUtc={selectedSlot?.startUtc ?? null}
              onPick={(s) => setSelectedSlot({ startUtc: s.startUtc, label: s.startInBookerTz })}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="text" type="button" onClick={() => router.back()} disabled={submitting}>
            Back
          </Button>
          <Button
            variant="filled"
            type="button"
            disabled={!selectedSlot || submitting}
            loading={submitting}
            onClick={handleSubmit}
          >
            Confirm new time
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}

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
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = isoDateLocal(new Date());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="text" type="button" onClick={onPrev} aria-label="Previous month">
          {'‹'}
        </Button>
        <span className="text-title-m text-on-surface" aria-live="polite">
          {monthLabel}
        </span>
        <Button variant="text" type="button" onClick={onNext} aria-label="Next month">
          {'›'}
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-body-s text-on-surface-variant">
        {weekdayLabels.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className={`grid grid-cols-7 gap-1 ${loading ? 'opacity-60' : ''}`}>
        {grid.map(({ date, key, inMonth }) => {
          const slots = slotsByDay.get(key) ?? [];
          const available = slots.length > 0;
          const isPast = key < today;
          const dim = !inMonth || isPast;
          const enabled = available && !isPast;
          return (
            <button
              key={key}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && onPick(key)}
              className={[
                'aspect-square rounded-shape-xs text-body-m transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                enabled
                  ? 'bg-primary-container text-on-primary-container font-medium hover:bg-primary hover:text-on-primary'
                  : 'text-on-surface-variant',
                dim && 'opacity-40',
                key === today && 'ring-1 ring-primary',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      {loading && <p className="text-body-s text-on-surface-variant">Loading availability...</p>}
    </div>
  );
}

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
      <p className="py-6 text-center text-body-m text-on-surface-variant">
        No availability on this day.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {slots.map((s) => {
        const isSel = s.startUtc === selectedStartUtc;
        return (
          <button
            key={s.startUtc}
            type="button"
            onClick={() => onPick(s)}
            className={[
              'rounded-full border px-4 py-2 text-body-m transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              isSel
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline text-on-surface hover:border-primary hover:bg-primary-container hover:text-on-primary-container',
            ].join(' ')}
          >
            {s.startInBookerTz}
          </button>
        );
      })}
    </div>
  );
}
