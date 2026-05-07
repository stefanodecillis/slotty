import { notFound } from 'next/navigation';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Snackbar } from '@/components/ui/Snackbar';
import { EventTypeForm } from '../_components/event-type-form';
import type {
  ConnectedAccountOption,
  CalendarOption,
  ScheduleOption,
  EventTypeFormValues,
} from '../_components/event-type-form';
import type { LocationKind, QuestionKind } from '@/lib/eventtype/validator';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
}

export default async function EditEventTypePage({ params }: PageProps) {
  const user = await requireUserOrRedirect(`/admin/login?next=%2Fadmin%2Fevent-types%2F${params.id}`);

  const [eventType, accounts, calendars, schedules] = await Promise.all([
    db.eventType.findUnique({
      where: { id: params.id },
      include: {
        questions: { orderBy: { position: 'asc' } },
      },
    }),
    db.connectedAccount.findMany({
      where: { status: 'active' },
      select: { id: true, googleUserEmail: true },
    }),
    db.calendar.findMany({
      select: {
        id: true,
        connectedAccountId: true,
        name: true,
        isDestinationEligible: true,
      },
    }),
    db.schedule.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
    }),
  ]);

  if (!eventType || eventType.userId !== user.id) {
    notFound();
  }

  const accountOptions: ConnectedAccountOption[] = accounts.map((a) => ({
    id: a.id,
    googleUserEmail: a.googleUserEmail,
  }));

  const calendarOptions: CalendarOption[] = calendars.map((c) => ({
    id: c.id,
    connectedAccountId: c.connectedAccountId,
    name: c.name,
    isDestinationEligible: c.isDestinationEligible,
  }));

  const scheduleOptions: ScheduleOption[] = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    isDefault: s.isDefault,
  }));

  const initialValues: Partial<EventTypeFormValues> = {
    title: eventType.title,
    slug: eventType.slug,
    descriptionMd: eventType.descriptionMd ?? '',
    color: eventType.color,
    hidden: eventType.hidden,
    durationMinutes: eventType.durationMinutes,
    locationKind: eventType.locationKind as LocationKind,
    locationValue: eventType.locationValue ?? '',
    destinationAccountId: eventType.destinationAccountId,
    destinationCalendarId: eventType.destinationCalendarId,
    bufferBeforeMin: eventType.bufferBeforeMin,
    bufferAfterMin: eventType.bufferAfterMin,
    minNoticeMin: eventType.minNoticeMin,
    bookingWindowDays: eventType.bookingWindowDays,
    maxPerDay: eventType.maxPerDay ?? '',
    maxPerWeek: eventType.maxPerWeek ?? '',
    slotIntervalMin: eventType.slotIntervalMin,
    scheduleId: eventType.scheduleId ?? '',
    confirmationMd: eventType.confirmationMd ?? '',
    redirectUrl: eventType.redirectUrl ?? '',
    password: '',
    sendReminders: eventType.sendReminders,
    questions: eventType.questions.map((q) => ({
      id: q.id,
      label: q.label,
      helperText: q.helperText ?? '',
      kind: q.kind as QuestionKind,
      required: q.required,
      optionsJson: q.optionsJson ?? '',
      position: q.position,
    })),
  };

  return (
    <Snackbar.Provider>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <nav className="text-body-s text-on-surface-variant">
            <Link href="/admin/event-types" className="hover:text-on-surface">
              Event Types
            </Link>{' '}
            &rsaquo; Edit
          </nav>
          <h1 className="text-display-s text-on-background">Edit: {eventType.title}</h1>
        </header>

        <EventTypeForm
          mode="edit"
          eventTypeId={eventType.id}
          initialValues={initialValues}
          accounts={accountOptions}
          allCalendars={calendarOptions}
          schedules={scheduleOptions}
        />
      </div>
    </Snackbar.Provider>
  );
}
