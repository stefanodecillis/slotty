import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { EventTypeForm } from '../_components/event-type-form';
import type {
  ConnectedAccountOption,
  CalendarOption,
  ScheduleOption,
  BrandOption,
  EventTypeFormValues,
} from '../_components/event-type-form';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function NewEventTypePage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fevent-types%2Fnew');

  const [accounts, calendars, schedules, brands, owner] = await Promise.all([
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
    db.user.findUnique({ where: { id: user.id }, select: { defaultBrandId: true } }),
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

  const brandOptions: BrandOption[] = brands.map((b) => ({
    id: b.id,
    name: b.name,
    primaryColor: b.primaryColor,
  }));

  // Prefill from the user's default brand (if any and still exists).
  const defaultBrandId =
    owner?.defaultBrandId && brands.some((b) => b.id === owner.defaultBrandId)
      ? owner.defaultBrandId
      : '';
  const initialValues: Partial<EventTypeFormValues> = { brandId: defaultBrandId };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <nav className="text-xs text-muted-foreground">
          <Link href="/admin/event-types" className="hover:text-foreground">
            Event Types
          </Link>{' '}
          &rsaquo; New
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">New Event Type</h1>
      </header>

      <EventTypeForm
        mode="create"
        username={user.username}
        initialValues={initialValues}
        accounts={accountOptions}
        allCalendars={calendarOptions}
        schedules={scheduleOptions}
        brands={brandOptions}
      />
    </div>
  );
}
