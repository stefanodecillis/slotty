import Link from 'next/link';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Clock, Download, Archive, Info, Lock, Webhook, ChevronRight } from 'lucide-react';
import { GeneralForm } from './general-form';

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
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Configure how Slotty works for you.
        </p>
      </header>

      {/* Tabs */}
      <nav
        aria-label="Settings tabs"
        className="mb-8 flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={`/admin/settings?tab=${t.id}`}
              scroll={false}
              className={[
                'inline-flex h-12 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
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
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Security →
          </Link>
          <Link
            href="/admin/settings/webhooks"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Webhooks →
          </Link>
        </div>
      </nav>

      {tab === 'general' && (
        <section>
          <h2 className="text-lg font-semibold text-foreground">General</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Default timezone and locale preferences.
          </p>
          <div className="rounded-lg bg-muted/50 p-6">
            <GeneralForm user={user} timezones={timezones} siteUrl={siteUrl} />
          </div>
        </section>
      )}

      {tab === 'branding' && (
        <section>
          <h2 className="text-lg font-semibold text-foreground">Branding</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Theme appearance for your Slotty instance.
          </p>
          <div className="rounded-lg bg-muted/50 p-6">
            <p className="text-sm text-muted-foreground">
              Theme is system-controlled (light/dark via OS preference).
            </p>
          </div>
        </section>
      )}

      {tab === 'backup' && (
        <section>
          <h2 className="text-lg font-semibold text-foreground">Backup &amp; export</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Download a snapshot of your database, or export everything as a structured archive.
          </p>
          <div className="rounded-lg bg-muted/50 p-6">
            <div className="flex flex-col gap-5">
              {lastBackup && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Last backup: {lastBackup.toISOString().replace('T', ' ').slice(0, 19)} UTC
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <a href="/api/admin/backup/snapshot">
                  <Button variant="secondary" type="button">
                    <Download className="h-4 w-4" />
                    SQLite snapshot
                  </Button>
                </a>
                <a href="/api/admin/backup/export">
                  <Button variant="outline" type="button">
                    <Archive className="h-4 w-4" />
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
          <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            How Slotty handles transactional email.
          </p>
          <div className="rounded-lg bg-muted/50 p-6">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
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
        <h2 className="mb-3 text-lg font-semibold text-foreground">More</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Link
            href="/admin/settings/security"
            className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-3">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <span className="text-base font-medium text-foreground">Security</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
          <Link
            href="/admin/settings/webhooks"
            className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-3">
              <Webhook className="h-5 w-5 text-muted-foreground" />
              <span className="text-base font-medium text-foreground">Webhooks</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </section>
    </div>
  );
}
