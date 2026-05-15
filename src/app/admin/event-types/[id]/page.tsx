import { notFound } from 'next/navigation';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { parseHiddenGuests } from '@/lib/eventtype/service';
import { EventTypeForm } from '../_components/event-type-form';
import { InviteLinksPanel } from '../_components/invite-links-panel';
import type {
  ConnectedAccountOption,
  CalendarOption,
  ScheduleOption,
  BrandOption,
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

  const [eventType, accounts, calendars, schedules, brands] = await Promise.all([
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
    db.brand.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, primaryColor: true },
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

  const brandOptions: BrandOption[] = brands.map((b) => ({
    id: b.id,
    name: b.name,
    primaryColor: b.primaryColor,
  }));

  const initialValues: Partial<EventTypeFormValues> = {
    title: eventType.title,
    slug: eventType.slug,
    descriptionMd: eventType.descriptionMd ?? '',
    color: eventType.color,
    hidden: eventType.hidden,
    inviteOnly: eventType.inviteOnly,
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
    maxGuests: eventType.maxGuests,
    slotIntervalMin: eventType.slotIntervalMin,
    scheduleId: eventType.scheduleId ?? '',
    brandId: eventType.brandId ?? '',
    confirmationMd: eventType.confirmationMd ?? '',
    redirectUrl: eventType.redirectUrl ?? '',
    password: '',
    sendReminders: eventType.sendReminders,
    hiddenGuests: parseHiddenGuests(eventType.hiddenGuestsJson),
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <nav className="text-xs text-muted-foreground">
          <Link href="/admin/event-types" className="hover:text-foreground">
            Event Types
          </Link>{' '}
          &rsaquo; Edit
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Edit: {eventType.title}</h1>
      </header>

      <EventTypeForm
        mode="edit"
        eventTypeId={eventType.id}
        username={user.username}
        initialValues={initialValues}
        accounts={accountOptions}
        allCalendars={calendarOptions}
        schedules={scheduleOptions}
        brands={brandOptions}
      />

      <InviteLinksPanel
        eventTypeId={eventType.id}
        eventTypeHiddenGuestsCount={parseHiddenGuests(eventType.hiddenGuestsJson).length}
      />
    </div>
  );
}
