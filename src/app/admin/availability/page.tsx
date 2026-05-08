import { requireUserOrRedirect } from '@/lib/auth/session';
import { ensureDefaultSchedule } from '@/lib/availability/schedule';
import { listDateOverrides } from '@/lib/availability/overrides';
import { SlidersHorizontal, Globe } from 'lucide-react';
import { WeeklyGrid } from './_components/weekly-grid';
import { OverridesCalendar } from './_components/overrides-calendar';
import { HolidayImport } from './_components/holiday-import';
import { DateTime } from 'luxon';

export const dynamic = 'force-dynamic';

export default async function AvailabilityPage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Favailability');

  const schedule = await ensureDefaultSchedule(user.id, user.timezone);

  // Load overrides for current + next 2 months
  const now = DateTime.now().setZone(user.timezone);
  const from = now.startOf('month').toJSDate();
  const to = now.plus({ months: 2 }).endOf('month').toJSDate();
  const overrides = await listDateOverrides(schedule.id, from, to);

  const rulesForClient = schedule.rules.map((r) => ({
    weekday: r.weekday,
    startMinute: r.startMinute,
    endMinute: r.endMinute,
  }));

  const overridesForClient = overrides.map((o) => ({
    id: o.id,
    date: DateTime.fromJSDate(o.date, { zone: 'utc' }).toISODate() ?? '',
    isBlocked: o.isBlocked,
    startMinute: o.startMinute,
    endMinute: o.endMinute,
    source: o.source,
    label: o.label,
  }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Availability</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Set the hours when people can book time with you.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal className="h-4 w-4" />
            Schedule:{' '}
            <span className="font-medium text-foreground">{schedule.name}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-4 w-4" />
            Timezone:{' '}
            <span className="font-medium text-foreground">{schedule.timezone}</span>
          </span>
        </div>
      </header>

      {/* Weekly schedule */}
      <section>
        <h2 className="text-lg font-semibold text-foreground">Weekly hours</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Set your default available hours for each day of the week.
        </p>
        <div className="rounded-lg bg-muted/50 p-6">
          <WeeklyGrid scheduleId={schedule.id} initialRules={rulesForClient} />
        </div>
      </section>

      {/* Date overrides */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-foreground">Date overrides</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Block specific dates or set custom hours that differ from your weekly schedule.
        </p>
        <div className="rounded-lg bg-muted/50 p-6">
          <OverridesCalendar
            scheduleId={schedule.id}
            initialOverrides={overridesForClient}
            timezone={schedule.timezone}
          />
        </div>
      </section>

      {/* Holiday import */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-foreground">Import holidays</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Import public holidays from an iCal feed to automatically block those dates.
        </p>
        <div className="rounded-lg bg-muted/50 p-6">
          <HolidayImport scheduleId={schedule.id} />
        </div>
      </section>
    </div>
  );
}
