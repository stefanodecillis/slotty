import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
import { SnackbarProvider } from '@/components/ui/Snackbar';
import { EventTypeForm } from '../_components/event-type-form';
import type { ConnectedAccountOption, CalendarOption, ScheduleOption } from '../_components/event-type-form';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function NewEventTypePage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fevent-types%2Fnew');

  const [accounts, calendars, schedules] = await Promise.all([
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

  return (
    <SnackbarProvider>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <nav className="text-body-s text-on-surface-variant">
            <Link href="/admin/event-types" className="hover:text-on-surface">
              Event Types
            </Link>{' '}
            &rsaquo; New
          </nav>
          <h1 className="text-display-s text-on-background">New Event Type</h1>
        </header>

        <EventTypeForm
          mode="create"
          username={user.username}
          accounts={accountOptions}
          allCalendars={calendarOptions}
          schedules={scheduleOptions}
        />
      </div>
    </SnackbarProvider>
  );
}
