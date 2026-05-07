import { requireUserOrRedirect } from '@/lib/auth/session';
import { ensureDefaultSchedule } from '@/lib/availability/schedule';
import { listDateOverrides } from '@/lib/availability/overrides';
import { SnackbarProvider } from '@/components/ui/Snackbar';
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
    <SnackbarProvider>
      <div className="mx-auto flex max-w-4xl flex-col">
        <header className="mb-8">
          <h1 className="text-display-s text-on-background">Availability</h1>
          <p className="mt-1 text-body-l text-on-surface-variant">
            Set the hours when people can book time with you.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-body-s text-on-surface-variant">
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">tune</span>
              Schedule:{' '}
              <span className="font-medium text-on-surface">{schedule.name}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">public</span>
              Timezone:{' '}
              <span className="font-medium text-on-surface">{schedule.timezone}</span>
            </span>
          </div>
        </header>

        {/* Weekly schedule */}
        <section>
          <h2 className="text-title-l text-on-surface">Weekly hours</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            Set your default available hours for each day of the week.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <WeeklyGrid scheduleId={schedule.id} initialRules={rulesForClient} />
          </div>
        </section>

        {/* Date overrides */}
        <section className="mt-12">
          <h2 className="text-title-l text-on-surface">Date overrides</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            Block specific dates or set custom hours that differ from your weekly schedule.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <OverridesCalendar
              scheduleId={schedule.id}
              initialOverrides={overridesForClient}
              timezone={schedule.timezone}
            />
          </div>
        </section>

        {/* Holiday import */}
        <section className="mt-12">
          <h2 className="text-title-l text-on-surface">Import holidays</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            Import public holidays from an iCal feed to automatically block those dates.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <HolidayImport scheduleId={schedule.id} />
          </div>
        </section>
      </div>
    </SnackbarProvider>
  );
}
