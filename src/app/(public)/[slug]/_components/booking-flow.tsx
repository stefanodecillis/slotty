'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { useSnackbar } from '@/components/ui/Snackbar';
import type { SlotResult } from '@/lib/scheduling/compute-types';

import { TzSelector, getInitialBookerTz } from './tz-selector';

interface Question {
  id: string;
  label: string;
  helperText: string | null;
  kind: string;
  required: boolean;
  optionsJson: string | null;
}

interface Props {
  slug: string;
  title: string;
  durationMinutes: number;
  eventTypeId: string;
  ownerTimezone: string;
  questions: Question[];
  passwordRequired: boolean;
}

type Step = 'date' | 'time' | 'details' | 'submitting' | 'pending';

/**
 * Three-step public booking flow:
 *   1. pick a date (calendar grid; days with >= 1 slot are highlighted)
 *   2. pick a time chip from that date's slot list
 *   3. fill in name/email/notes/custom-questions and submit
 *
 * Step 3's submit hits POST /api/public/bookings — Phase 7 will wire the
 * actual handler. Phase 6 surfaces the 503 with a friendly notice so the UI
 * is testable end-to-end except for the final write.
 */
export function BookingFlow(props: Props) {
  const { slug, title, durationMinutes, questions, passwordRequired } = props;
  const { show } = useSnackbar();

  const [bookerTz, setBookerTz] = useState<string>('UTC');
  useEffect(() => setBookerTz(getInitialBookerTz()), []);

  const [step, setStep] = useState<Step>('date');
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonthLocal(new Date()));
  const [slotsByDay, setSlotsByDay] = useState<Map<string, SlotResult['days'][number]['slots']>>(
    new Map(),
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ startUtc: string; label: string } | null>(
    null,
  );
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [guests, setGuests] = useState('');
  const [notes, setNotes] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Load slots whenever month or tz changes.
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
      } catch (err) {
        if (!cancelled) {
          show({ message: 'Could not load slots. Please try again.' });
          // Keep the rest of the UI usable even on failure.
          setSlotsByDay(new Map());
        }
        void err;
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

  function handlePickDate(dateKey: string) {
    setSelectedDate(dateKey);
    setSelectedSlot(null);
    setStep('time');
  }

  function handlePickSlot(slot: { startUtc: string; label: string }) {
    setSelectedSlot(slot);
    setStep('details');
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSlot) return;
    if (!emailLooksValid(email)) {
      show({ message: 'Please enter a valid email address.' });
      return;
    }
    setStep('submitting');
    try {
      const res = await fetch('/api/public/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          startUtc: selectedSlot.startUtc,
          name,
          email,
          guests: guests
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
          notes,
          answers,
          bookerTz,
        }),
      });
      if (res.status === 503) {
        show({
          message: 'Booking submissions go live in Phase 7. Your details are valid.',
        });
        setStep('pending');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Phase 7 will return a redirect URL.
      setStep('pending');
    } catch (err) {
      show({ message: 'Submission failed. Please try again.' });
      setStep('details');
      void err;
    }
  }

  // ───────── render ─────────

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Card variant="outlined">
          <Card.Header>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-title-m text-on-surface">
                {step === 'date' && 'Select a date'}
                {step === 'time' && 'Select a time'}
                {(step === 'details' || step === 'submitting') && 'Your details'}
                {step === 'pending' && 'Almost there'}
              </h2>
              {step === 'time' && (
                <Button variant="text" onClick={() => setStep('date')}>
                  Back
                </Button>
              )}
              {step === 'details' && (
                <Button variant="text" onClick={() => setStep('time')}>
                  Back
                </Button>
              )}
            </div>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            {passwordRequired && (
              <p className="rounded-shape-xs bg-tertiary-container px-3 py-2 text-body-s text-on-tertiary-container">
                This event type is protected by a password. Phase 7 will add the unlock
                challenge here.
              </p>
            )}

            {step === 'date' && (
              <DateGrid
                monthAnchor={monthAnchor}
                grid={monthGrid}
                slotsByDay={slotsByDay}
                loading={loadingSlots}
                onPrev={() => setMonthAnchor(addMonths(monthAnchor, -1))}
                onNext={() => setMonthAnchor(addMonths(monthAnchor, 1))}
                onPick={handlePickDate}
              />
            )}

            {step === 'time' && selectedDate && (
              <TimeGrid
                slots={slotsByDay.get(selectedDate) ?? []}
                onPick={(s) => handlePickSlot({ startUtc: s.startUtc, label: s.startInBookerTz })}
              />
            )}

            {(step === 'details' || step === 'submitting') && (
              <DetailsForm
                name={name}
                setName={setName}
                email={email}
                setEmail={setEmail}
                guests={guests}
                setGuests={setGuests}
                notes={notes}
                setNotes={setNotes}
                answers={answers}
                setAnswers={setAnswers}
                questions={questions}
                onSubmit={handleSubmit}
                submitting={step === 'submitting'}
              />
            )}

            {step === 'pending' && (
              <div className="flex flex-col gap-3 py-6 text-center">
                <span
                  className="material-symbols-outlined mx-auto text-[40px] text-primary"
                  aria-hidden
                >
                  hourglass_top
                </span>
                <h3 className="text-title-l text-on-surface">Booking submission queued</h3>
                <p className="text-body-m text-on-surface-variant">
                  Phase 7 will deliver this to the calendar with a confirmation email and an
                  ICS attachment.
                </p>
              </div>
            )}
          </Card.Content>
        </Card>
      </div>

      <aside className="flex flex-col gap-4">
        <Card variant="filled">
          <Card.Header>
            <h2 className="text-title-m text-on-surface">{title}</h2>
            <p className="mt-0.5 text-body-s text-on-surface-variant">{durationMinutes} minutes</p>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {selectedDate && (
              <p className="text-body-m text-on-surface">
                <span className="text-on-surface-variant">Date: </span>
                {formatHumanDate(selectedDate, bookerTz)}
              </p>
            )}
            {selectedSlot && (
              <p className="text-body-m text-on-surface">
                <span className="text-on-surface-variant">Time: </span>
                {selectedSlot.label}
              </p>
            )}
            <TzSelector value={bookerTz} onChange={setBookerTz} />
          </Card.Content>
        </Card>
      </aside>
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
  // Sunday-anchored grid (column 0 = Sun).
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

function emailLooksValid(value: string): boolean {
  // Pragmatic RFC-ish check.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
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
        <Button variant="text" onClick={onPrev} aria-label="Previous month">
          ‹
        </Button>
        <span className="text-title-m text-on-surface" aria-live="polite">
          {monthLabel}
        </span>
        <Button variant="text" onClick={onNext} aria-label="Next month">
          ›
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
      {loading && <p className="text-body-s text-on-surface-variant">Loading availability…</p>}
    </div>
  );
}

function TimeGrid({
  slots,
  onPick,
}: {
  slots: SlotResult['days'][number]['slots'];
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
      {slots.map((s) => (
        <button
          key={s.startUtc}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-full border border-outline px-4 py-2 text-body-m text-on-surface transition-colors hover:border-primary hover:bg-primary-container hover:text-on-primary-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {s.startInBookerTz}
        </button>
      ))}
    </div>
  );
}

function DetailsForm({
  name,
  setName,
  email,
  setEmail,
  guests,
  setGuests,
  notes,
  setNotes,
  answers,
  setAnswers,
  questions,
  onSubmit,
  submitting,
}: {
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  guests: string;
  setGuests: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  questions: Question[];
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <TextField label="Your name" value={name} onChange={setName} required />
      <TextField label="Email" type="email" value={email} onChange={setEmail} required />
      <TextField
        label="Additional guests (comma-separated)"
        value={guests}
        onChange={setGuests}
        placeholder="alice@example.com, bob@example.com"
      />
      <label className="flex flex-col gap-1">
        <span className="px-1 text-body-s text-on-surface-variant">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="rounded-shape-xs border border-outline bg-transparent px-4 py-3 text-body-l text-on-surface focus:border-2 focus:border-primary focus:outline-none"
        />
      </label>

      {questions.map((q) => (
        <CustomQuestion
          key={q.id}
          question={q}
          value={answers[q.id] ?? ''}
          onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
        />
      ))}

      <Button type="submit" loading={submitting} disabled={submitting} fullWidth>
        Confirm booking
      </Button>
    </form>
  );
}

function CustomQuestion({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  if (question.kind === 'textarea') {
    return (
      <label className="flex flex-col gap-1">
        <span className="px-1 text-body-s text-on-surface-variant">
          {question.label}
          {question.required && <span aria-hidden> *</span>}
        </span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={question.required}
          rows={3}
          className="rounded-shape-xs border border-outline bg-transparent px-4 py-3 text-body-l text-on-surface focus:border-2 focus:border-primary focus:outline-none"
        />
        {question.helperText && (
          <span className="px-1 text-body-s text-on-surface-variant">{question.helperText}</span>
        )}
      </label>
    );
  }
  if (question.kind === 'select' || question.kind === 'radio') {
    let options: string[] = [];
    try {
      options = question.optionsJson ? (JSON.parse(question.optionsJson) as string[]) : [];
    } catch {
      options = [];
    }
    return (
      <fieldset className="flex flex-col gap-1">
        <legend className="px-1 text-body-s text-on-surface-variant">
          {question.label}
          {question.required && <span aria-hidden> *</span>}
        </legend>
        <div className="flex flex-col gap-1 px-1">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-body-m text-on-surface">
              <input
                type="radio"
                name={question.id}
                value={opt}
                checked={value === opt}
                onChange={(e) => onChange(e.target.value)}
                required={question.required}
              />
              {opt}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 px-1 text-body-m text-on-surface">
        <input
          type="checkbox"
          checked={value === 'on'}
          onChange={(e) => onChange(e.target.checked ? 'on' : '')}
        />
        {question.label}
        {question.required && <span aria-hidden> *</span>}
      </label>
    );
  }
  return (
    <TextField
      label={question.label}
      value={value}
      onChange={onChange}
      required={question.required}
      helperText={question.helperText ?? undefined}
    />
  );
}
