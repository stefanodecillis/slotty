import { requireUserOrRedirect } from '@/lib/auth/session';
import { ensureDefaultSchedule } from '@/lib/availability/schedule';
import { listDateOverrides } from '@/lib/availability/overrides';
import { Card } from '@/components/ui/Card';
import { Snackbar } from '@/components/ui/Snackbar';
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
    <Snackbar.Provider>
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="text-label-l text-on-surface-variant">Availability</p>
          <h1 className="text-display-s text-on-background">Manage Availability</h1>
          <p className="text-body-m text-on-surface-variant">
            Schedule: <span className="font-medium text-on-surface">{schedule.name}</span>
            {' '}&middot;{' '}
            Timezone: <span className="font-medium text-on-surface">{schedule.timezone}</span>
          </p>
        </header>

        {/* Weekly schedule */}
        <Card variant="outlined">
          <Card.Header>
            <h2 className="text-headline-s text-on-surface">Weekly Hours</h2>
            <p className="text-body-m text-on-surface-variant">
              Set your default available hours for each day of the week.
            </p>
          </Card.Header>
          <Card.Content>
            <WeeklyGrid scheduleId={schedule.id} initialRules={rulesForClient} />
          </Card.Content>
        </Card>

        {/* Date overrides */}
        <Card variant="outlined">
          <Card.Header>
            <h2 className="text-headline-s text-on-surface">Date Overrides</h2>
            <p className="text-body-m text-on-surface-variant">
              Block specific dates or set custom hours that differ from your weekly schedule.
            </p>
          </Card.Header>
          <Card.Content>
            <OverridesCalendar
              scheduleId={schedule.id}
              initialOverrides={overridesForClient}
              timezone={schedule.timezone}
            />
          </Card.Content>
        </Card>

        {/* Holiday import */}
        <Card variant="outlined">
          <Card.Header>
            <h2 className="text-headline-s text-on-surface">Import Holidays</h2>
            <p className="text-body-m text-on-surface-variant">
              Import public holidays from an iCal feed to automatically block those dates.
            </p>
          </Card.Header>
          <Card.Content>
            <HolidayImport scheduleId={schedule.id} />
          </Card.Content>
        </Card>
      </div>
    </Snackbar.Provider>
  );
}
