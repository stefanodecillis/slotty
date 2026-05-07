import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { GeneralForm } from './general-form';
import { BrandingForm } from './branding-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settings' };

async function getLastBackupDate(): Promise<Date | null> {
  const job = await db.job.findFirst({
    where: { kind: 'daily_backup', status: 'done' },
    orderBy: { updatedAt: 'desc' },
  });
  return job?.updatedAt ?? null;
}

export default async function SettingsPage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fsettings');

  const timezones: string[] = (Intl as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf?.('timeZone') ?? ['UTC'];

  const lastBackup = await getLastBackupDate();

  const siteUrl = env.SLOTTY_PUBLIC_URL;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-headline-m text-on-surface">Settings</h1>
        <p className="text-body-m text-on-surface-variant">
          Configure Slotty to match your preferences.
        </p>
      </header>

      {/* General */}
      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">General</h2>
        </Card.Header>
        <Card.Content>
          <GeneralForm user={user} timezones={timezones} siteUrl={siteUrl} />
        </Card.Content>
      </Card>

      {/* Branding */}
      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Branding</h2>
          <p className="text-body-m text-on-surface-variant">
            Customize the look and feel of your Slotty instance.
          </p>
        </Card.Header>
        <Card.Content>
          <BrandingForm user={user} />
        </Card.Content>
      </Card>

      {/* Backup */}
      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Backup &amp; export</h2>
          {lastBackup && (
            <p className="text-body-s text-on-surface-variant">
              Last backup: {lastBackup.toISOString().replace('T', ' ').slice(0, 19)} UTC
            </p>
          )}
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col gap-4">
            <p className="text-body-m text-on-surface-variant">
              Download a point-in-time snapshot of the SQLite database, or export
              all your data as a structured ZIP archive.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/api/admin/backup/snapshot">
                <Button variant="tonal" type="button">
                  Download SQLite snapshot
                </Button>
              </a>
              <a href="/api/admin/backup/export">
                <Button variant="outlined" type="button">
                  Export all data (JSON + ICS)
                </Button>
              </a>
            </div>
          </div>
        </Card.Content>
      </Card>

      {/* Email notice */}
      <Card variant="outlined">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Email notifications</h2>
        </Card.Header>
        <Card.Content>
          <p className="text-body-m text-on-surface-variant">
            Slotty does not send transactional emails directly. Google Calendar sends
            invites, reschedule notices, and cancellations to all attendees automatically
            when you book through a Google Meet event type. To customize the sender domain
            or use branded emails, configure these settings in Google Workspace.
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}
