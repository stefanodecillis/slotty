'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
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
  color: string;
  durationMinutes: number;
  descriptionHtml: string;
  eventTypeId: string;
  ownerTimezone: string;
  ownerName: string;
  ownerAvatarPath: string | null;
  questions: Question[];
  passwordRequired: boolean;
}

type Step = 'date' | 'time' | 'details' | 'submitting' | 'pending';

const STEP_INDEX: Record<Step, number> = {
  date: 0,
  time: 1,
  details: 2,
  submitting: 2,
  pending: 3,
};

export function BookingFlow(props: Props) {
  const {
    slug,
    title,
    color,
    durationMinutes,
    descriptionHtml,
    ownerName,
    ownerAvatarPath,
    questions,
    passwordRequired,
  } = props;
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
  const [descExpanded, setDescExpanded] = useState(false);

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
      const clientRequestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch('/api/public/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventTypeSlug: slug,
          startAt: selectedSlot.startUtc,
          bookerName: name,
          bookerEmail: email,
          bookerTimezone: bookerTz,
          additionalGuests: guests
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
          notes,
          answers,
          clientRequestId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { manageUrl?: string };
      if (data.manageUrl) {
        window.location.href = data.manageUrl;
        return;
      }
      setStep('pending');
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : 'Submission failed. Please try again.',
      });
      setStep('details');
    }
  }

  const stepIndex = STEP_INDEX[step];
  const isPendingOrDone = step === 'pending';

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-10">
        {/* Left summary panel */}
        <aside className="w-full shrink-0 sm:sticky sm:top-10 sm:w-56">
          <div className="flex flex-col gap-5 rounded-shape-xl border border-outline-variant/60 bg-surface-container-low p-5">
            <div className="flex items-center gap-3">
              {ownerAvatarPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ownerAvatarPath}
                  alt={ownerName}
                  className="h-10 w-10 shrink-0 rounded-full border border-outline-variant object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
                  <span className="text-title-m select-none">
                    {ownerName.slice(0, 1).toUpperCase()}
                  </span>
                </div>
              )}
              <span className="text-body-m text-on-surface-variant">{ownerName}</span>
            </div>

            <div className="border-t border-outline-variant/40" />

            <div>
              <h1 className="text-title-l text-on-surface" style={{ color }}>
                {title}
              </h1>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-body-m text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px]" aria-hidden>
                  schedule
                </span>
                <span>{durationLabel(durationMinutes)}</span>
              </div>
              <div className="flex items-center gap-2 text-body-m text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px]" aria-hidden>
                  videocam
                </span>
                <span>Video call</span>
              </div>
            </div>

            {descriptionHtml && (
              <div>
                <div
                  className={[
                    'text-body-s text-on-surface-variant [&_a]:text-primary [&_a]:underline',
                    descExpanded ? '' : 'line-clamp-3',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  /* Content is sanitized via renderMarkdown / DOMPurify before reaching this component */
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                />
                {!descExpanded && (
                  <button
                    type="button"
                    onClick={() => setDescExpanded(true)}
                    className="mt-1 text-body-s text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    more
                  </button>
                )}
              </div>
            )}

            {selectedDate && (
              <div className="rounded-shape-sm bg-primary-container px-3 py-2">
                <p className="text-body-s font-medium text-on-primary-container">
                  {formatHumanDate(selectedDate, bookerTz)}
                </p>
                {selectedSlot && (
                  <p className="mt-0.5 text-body-s text-on-primary-container">
                    {selectedSlot.label}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Right wizard */}
        <div className="min-w-0 flex-1">
          {!isPendingOrDone && (
            <div className="mb-6 flex items-center gap-2">
              {(['date', 'time', 'details'] as const).map((s, i) => (
                <span
                  key={s}
                  className={[
                    'h-2 rounded-full transition-all duration-200',
                    i === stepIndex
                      ? 'w-6 bg-primary'
                      : i < stepIndex
                        ? 'w-2 bg-primary/40'
                        : 'w-2 bg-outline-variant',
                  ].join(' ')}
                  aria-hidden
                />
              ))}
              <span className="ml-2 text-label-m text-on-surface-variant">
                {step === 'date' && 'Select a date'}
                {step === 'time' && 'Select a time'}
                {(step === 'details' || step === 'submitting') && 'Your details'}
              </span>
            </div>
          )}

          {passwordRequired && (
            <div className="mb-4 flex items-start gap-3 rounded-shape-md border border-outline-variant bg-surface-container px-4 py-3">
              <span className="material-symbols-outlined mt-0.5 text-[18px] text-tertiary" aria-hidden>
                lock
              </span>
              <p className="text-body-s text-on-surface-variant">
                This event type is password-protected.
              </p>
            </div>
          )}

          <div className="relative">
            <StepPanel active={step === 'date'}>
              <div className="flex items-center justify-between gap-4 mb-5">
                <h2 className="text-title-l text-on-surface">Pick a date</h2>
                <TzSelector value={bookerTz} onChange={setBookerTz} />
              </div>
              <DateGrid
                monthAnchor={monthAnchor}
                grid={monthGrid}
                slotsByDay={slotsByDay}
                loading={loadingSlots}
                onPrev={() => setMonthAnchor(addMonths(monthAnchor, -1))}
                onNext={() => setMonthAnchor(addMonths(monthAnchor, 1))}
                onPick={handlePickDate}
              />
            </StepPanel>

            <StepPanel active={step === 'time'}>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-title-l text-on-surface">Pick a time</h2>
                  {selectedDate && (
                    <p className="mt-0.5 text-body-s text-on-surface-variant">
                      {formatHumanDate(selectedDate, bookerTz)}
                    </p>
                  )}
                </div>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => setStep('date')}
                >
                  Back
                </Button>
              </div>
              {selectedDate && (
                <TimeGrid
                  slots={slotsByDay.get(selectedDate) ?? []}
                  onPick={(s) => handlePickSlot({ startUtc: s.startUtc, label: s.startInBookerTz })}
                />
              )}
            </StepPanel>

            <StepPanel active={step === 'details' || step === 'submitting'}>
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="text-title-l text-on-surface">Your details</h2>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => setStep('time')}
                  disabled={step === 'submitting'}
                >
                  Back
                </Button>
              </div>
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
            </StepPanel>

            <StepPanel active={step === 'pending'}>
              <div className="flex flex-col items-center gap-4 py-12 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tertiary-container">
                  <span
                    className="material-symbols-outlined text-[32px] text-tertiary"
                    aria-hidden
                  >
                    hourglass_top
                  </span>
                </div>
                <h2 className="text-headline-s text-on-surface">Booking submitted</h2>
                <p className="max-w-sm text-body-m text-on-surface-variant">
                  Your request has been queued. A confirmation will arrive in your inbox shortly.
                </p>
              </div>
            </StepPanel>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className={[
        'transition-all duration-200',
        active
          ? 'pointer-events-auto opacity-100 translate-x-0'
          : 'pointer-events-none opacity-0 absolute inset-0 translate-x-4',
      ].join(' ')}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
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
  const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const today = isoDateLocal(new Date());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden>chevron_left</span>
        </button>
        <span className="text-title-m text-on-surface" aria-live="polite">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden>chevron_right</span>
        </button>
      </div>

      <div className="grid grid-cols-7 text-center">
        {weekdayLabels.map((w) => (
          <div key={w} className="py-1 text-label-m text-on-surface-variant">
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
                'relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-body-m transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                enabled
                  ? 'cursor-pointer bg-primary-container text-on-primary-container font-medium hover:bg-primary hover:text-on-primary'
                  : 'cursor-default text-on-surface-variant',
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
        <p className="text-center text-body-s text-on-surface-variant" aria-live="polite">
          Loading availability...
        </p>
      )}
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
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="material-symbols-outlined text-[32px] text-on-surface-variant" aria-hidden>
          event_busy
        </span>
        <p className="text-body-m text-on-surface-variant">No availability on this day.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {slots.map((s) => (
        <button
          key={s.startUtc}
          type="button"
          onClick={() => onPick(s)}
          className="w-full rounded-shape-md border border-outline bg-transparent px-4 py-3 text-left text-body-l text-on-surface transition-colors hover:border-primary hover:bg-primary-container/50 hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-center"
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
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <TextField label="Your name" value={name} onChange={setName} required />
      <TextField label="Email address" type="email" value={email} onChange={setEmail} required />
      <TextField
        label="Additional guests (optional)"
        value={guests}
        onChange={setGuests}
        placeholder="alice@example.com, bob@example.com"
        helperText="Comma-separated email addresses"
      />
      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-body-s text-on-surface-variant">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything you want the organizer to know..."
          className="rounded-shape-md border border-outline bg-transparent px-4 py-3 text-body-l text-on-surface placeholder:text-on-surface-variant/50 focus:border-2 focus:border-primary focus:outline-none"
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

      <div className="pt-2">
        <Button
          type="submit"
          loading={submitting}
          disabled={submitting}
          fullWidth
          size="lg"
        >
          Confirm booking
        </Button>
        <p className="mt-3 text-center text-body-s text-on-surface-variant">
          A confirmation email will be sent to your address.
        </p>
      </div>
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
      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-body-s text-on-surface-variant">
          {question.label}
          {question.required && <span aria-hidden> *</span>}
        </span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={question.required}
          rows={3}
          className="rounded-shape-md border border-outline bg-transparent px-4 py-3 text-body-l text-on-surface focus:border-2 focus:border-primary focus:outline-none"
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
      <fieldset className="flex flex-col gap-2">
        <legend className="px-1 text-body-s text-on-surface-variant">
          {question.label}
          {question.required && <span aria-hidden> *</span>}
        </legend>
        <div className="flex flex-col gap-1.5 px-1">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-3 text-body-m text-on-surface">
              <input
                type="radio"
                name={question.id}
                value={opt}
                checked={value === opt}
                onChange={(e) => onChange(e.target.value)}
                required={question.required}
                className="accent-primary"
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
      <label className="flex items-center gap-3 px-1 text-body-m text-on-surface">
        <input
          type="checkbox"
          checked={value === 'on'}
          onChange={(e) => onChange(e.target.checked ? 'on' : '')}
          className="accent-primary"
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
