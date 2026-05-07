import Link from 'next/link';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/Button';
import { GeneralForm } from './general-form';
import { BrandingForm } from './branding-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settings' };

type Tab = 'general' | 'branding' | 'backup' | 'notifications';
const VALID_TABS: ReadonlyArray<Tab> = ['general', 'branding', 'backup', 'notifications'];

function isTab(value: string | undefined): value is Tab {
  return typeof value === 'string' && (VALID_TABS as readonly string[]).includes(value);
}

async function getLastBackupDate(): Promise<Date | null> {
  const job = await db.job.findFirst({
    where: { kind: 'daily_backup', status: 'done' },
    orderBy: { updatedAt: 'desc' },
  });
  return job?.updatedAt ?? null;
}

interface PageProps {
  searchParams?: { tab?: string };
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fsettings');

  const timezones: string[] = (Intl as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf?.('timeZone') ?? ['UTC'];

  const lastBackup = await getLastBackupDate();
  const siteUrl = env.SLOTTY_PUBLIC_URL;
  const tab: Tab = isTab(searchParams?.tab) ? (searchParams!.tab as Tab) : 'general';

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'branding', label: 'Branding' },
    { id: 'backup', label: 'Backup' },
    { id: 'notifications', label: 'Notifications' },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-6">
        <h1 className="text-display-s text-on-background">Settings</h1>
        <p className="mt-1 text-body-l text-on-surface-variant">
          Configure how Slotty works for you.
        </p>
      </header>

      {/* Tabs */}
      <nav
        aria-label="Settings tabs"
        className="mb-8 flex gap-1 overflow-x-auto border-b border-outline-variant"
      >
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={`/admin/settings?tab=${t.id}`}
              scroll={false}
              className={[
                'inline-flex h-12 items-center whitespace-nowrap border-b-2 px-4 text-label-l transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
            >
              {t.label}
            </Link>
          );
        })}
        <div className="ml-auto hidden items-center gap-3 pb-2 sm:flex">
          <Link
            href="/admin/settings/security"
            className="text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Security →
          </Link>
          <Link
            href="/admin/settings/webhooks"
            className="text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Webhooks →
          </Link>
        </div>
      </nav>

      {tab === 'general' && (
        <section>
          <h2 className="text-title-l text-on-surface">General</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            Default timezone and locale preferences.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <GeneralForm user={user} timezones={timezones} siteUrl={siteUrl} />
          </div>
        </section>
      )}

      {tab === 'branding' && (
        <section>
          <h2 className="text-title-l text-on-surface">Branding</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            Customize the look and feel of your Slotty instance.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <BrandingForm user={user} />
          </div>
        </section>
      )}

      {tab === 'backup' && (
        <section>
          <h2 className="text-title-l text-on-surface">Backup &amp; export</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            Download a snapshot of your database, or export everything as a structured archive.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <div className="flex flex-col gap-5">
              {lastBackup && (
                <p className="text-body-s text-on-surface-variant">
                  <span className="material-symbols-outlined align-middle text-[16px] mr-1">
                    schedule
                  </span>
                  Last backup: {lastBackup.toISOString().replace('T', ' ').slice(0, 19)} UTC
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <a href="/api/admin/backup/snapshot">
                  <Button
                    variant="tonal"
                    type="button"
                    leadingIcon={<span className="material-symbols-outlined">download</span>}
                  >
                    SQLite snapshot
                  </Button>
                </a>
                <a href="/api/admin/backup/export">
                  <Button
                    variant="outlined"
                    type="button"
                    leadingIcon={<span className="material-symbols-outlined">archive</span>}
                  >
                    Export all data
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'notifications' && (
        <section>
          <h2 className="text-title-l text-on-surface">Notifications</h2>
          <p className="mb-4 mt-1 text-body-m text-on-surface-variant">
            How Slotty handles transactional email.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-on-surface-variant">info</span>
              <p className="text-body-m text-on-surface-variant">
                Slotty does not send transactional emails directly. Google Calendar sends invites,
                reschedule notices, and cancellations to all attendees automatically when you book
                through a Google Meet event type. To customize the sender domain or use branded
                emails, configure these settings in Google Workspace.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Always-visible quick links to security/webhooks on mobile */}
      <section className="mt-12 sm:hidden">
        <h2 className="mb-3 text-title-l text-on-surface">More</h2>
        <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
          <Link
            href="/admin/settings/security"
            className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-container-low"
          >
            <span className="flex items-center gap-3">
              <span className="material-symbols-outlined text-on-surface-variant">lock</span>
              <span className="text-title-m text-on-surface">Security</span>
            </span>
            <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
          </Link>
          <Link
            href="/admin/settings/webhooks"
            className="flex items-center justify-between gap-3 border-t border-outline-variant px-5 py-4 transition-colors hover:bg-surface-container-low"
          >
            <span className="flex items-center gap-3">
              <span className="material-symbols-outlined text-on-surface-variant">webhook</span>
              <span className="text-title-m text-on-surface">Webhooks</span>
            </span>
            <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
