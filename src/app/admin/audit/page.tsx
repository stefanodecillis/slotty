import Link from 'next/link';
import { DateTime } from 'luxon';
import { History, Search } from 'lucide-react';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit Log' };

interface PageProps {
  searchParams: {
    action?: string;
    from?: string;
    to?: string;
    page?: string;
  };
}

const PAGE_SIZE = 100;

export default async function AuditLogPage({ searchParams }: PageProps) {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Faudit');

  const action = searchParams.action ?? '';
  const from = searchParams.from ?? '';
  const to = searchParams.to ?? '';
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  type AuditWhere = NonNullable<Parameters<typeof db.auditLog.findMany>[0]>['where'];
  // Owner-scope: show entries owned by the current user, plus system events
  // (which carry `userId = null`). This keeps the boundary correct if we
  // ever go multi-user without changing the data model.
  const where: AuditWhere = {
    OR: [{ userId: user.id }, { userId: null }],
  };
  if (action) where.action = { contains: action };
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as { gte?: Date }).gte = new Date(from);
    if (to) (where.createdAt as { lte?: Date }).lte = new Date(to);
  }

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(action || from || to);

  return (
    <div className="mx-auto flex max-w-5xl flex-col">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Audit log</h1>
        <p className="mt-1 text-base text-muted-foreground">
          {total === 0
            ? 'No events logged yet.'
            : `${total} event${total === 1 ? '' : 's'} recorded.`}
        </p>
      </header>

      {/* Filters */}
      <form
        method="GET"
        className="mb-6 flex flex-col gap-3 rounded-lg bg-muted/50 p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Action</span>
          <input
            type="text"
            name="action"
            defaultValue={action}
            placeholder="e.g. booking.created"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">To</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
          />
        </label>
        <div className="flex gap-2">
          {hasFilters && (
            <a
              href="/admin/audit"
              className="inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
            >
              Clear
            </a>
          )}
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Filter
          </button>
        </div>
      </form>

      <section>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 px-6 py-16 text-center">
            {hasFilters ? (
              <Search className="h-12 w-12 text-muted-foreground" />
            ) : (
              <History className="h-12 w-12 text-muted-foreground" />
            )}
            <h2 className="text-lg font-semibold text-foreground">
              {hasFilters ? 'No events match your filters' : 'No events recorded yet'}
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? 'Try widening the date range or clearing filters.'
                : 'Events will appear here as you use Slotty.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                    <th className="px-4 py-3 text-left font-medium">Action</th>
                    <th className="px-4 py-3 text-left font-medium">Actor</th>
                    <th className="px-4 py-3 text-left font-medium">Target</th>
                    <th className="px-4 py-3 text-left font-medium">IP</th>
                    <th className="px-4 py-3 text-left font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry, idx) => {
                    let metadata: Record<string, unknown> = {};
                    try {
                      metadata = JSON.parse(entry.metadataJson) as Record<string, unknown>;
                    } catch { /* ignore */ }
                    return (
                      <tr
                        key={entry.id}
                        className={`transition-colors hover:bg-muted/50 ${
                          idx > 0 ? 'border-t border-border' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {DateTime.fromJSDate(entry.createdAt).toLocaleString(DateTime.DATETIME_MED)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-muted/50 px-2 py-0.5 font-mono text-xs text-foreground">
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{entry.actor}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {entry.targetType && (
                            <span>
                              {entry.targetType}
                              {entry.targetId && (
                                <span className="ml-1 font-mono text-xs text-muted-foreground">
                                  {entry.targetId.slice(0, 8)}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          {entry.ip ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {Object.keys(metadata).length > 0 && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {JSON.stringify(metadata).slice(0, 80)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-4">
          {page > 1 ? (
            <Link
              href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page - 1) })}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Previous
            </Link>
          ) : (
            <span className="text-sm font-medium text-muted-foreground/50">Previous</span>
          )}
          <span className="text-xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page + 1) })}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Next
            </Link>
          ) : (
            <span className="text-sm font-medium text-muted-foreground/50">Next</span>
          )}
        </nav>
      )}
    </div>
  );
}
