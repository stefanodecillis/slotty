import Link from 'next/link';
import { DateTime } from 'luxon';
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
        <h1 className="text-display-s text-on-background">Audit log</h1>
        <p className="mt-1 text-body-l text-on-surface-variant">
          {total === 0
            ? 'No events logged yet.'
            : `${total} event${total === 1 ? '' : 's'} recorded.`}
        </p>
      </header>

      {/* Filters */}
      <form
        method="GET"
        className="mb-6 flex flex-col gap-3 rounded-shape-md bg-surface-container-low p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-label-m text-on-surface-variant">Action</span>
          <input
            type="text"
            name="action"
            defaultValue={action}
            placeholder="e.g. booking.created"
            className="rounded-shape-sm border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface outline-none transition-colors placeholder:text-on-surface-variant focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-m text-on-surface-variant">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-shape-sm border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface outline-none transition-colors focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label-m text-on-surface-variant">To</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-shape-sm border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface outline-none transition-colors focus:border-primary"
          />
        </label>
        <div className="flex gap-2">
          {hasFilters && (
            <a
              href="/admin/audit"
              className="inline-flex h-10 items-center justify-center rounded-full px-5 text-label-l text-on-surface-variant transition-colors hover:bg-on-surface-variant/[0.08]"
            >
              Clear
            </a>
          )}
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-label-l text-on-primary shadow-sm transition-colors hover:bg-primary/90"
          >
            Filter
          </button>
        </div>
      </form>

      <section>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-shape-md bg-surface-container-low px-6 py-16 text-center">
            <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
              {hasFilters ? 'search_off' : 'history'}
            </span>
            <h2 className="text-title-l text-on-surface">
              {hasFilters ? 'No events match your filters' : 'No events recorded yet'}
            </h2>
            <p className="max-w-sm text-body-m text-on-surface-variant">
              {hasFilters
                ? 'Try widening the date range or clearing filters.'
                : 'Events will appear here as you use Slotty.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-shape-md border border-outline-variant bg-surface">
            <div className="overflow-x-auto">
              <table className="min-w-full text-body-s">
                <thead className="bg-surface-container-low text-label-m text-on-surface-variant">
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
                        className={`transition-colors hover:bg-surface-container-low ${
                          idx > 0 ? 'border-t border-outline-variant' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">
                          {DateTime.fromJSDate(entry.createdAt).toLocaleString(DateTime.DATETIME_MED)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-surface-container-low px-2 py-0.5 font-mono text-body-s text-on-surface">
                            {entry.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">{entry.actor}</td>
                        <td className="px-4 py-3 text-on-surface-variant">
                          {entry.targetType && (
                            <span>
                              {entry.targetType}
                              {entry.targetId && (
                                <span className="ml-1 font-mono text-body-s text-on-surface-variant">
                                  {entry.targetId.slice(0, 8)}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-on-surface-variant">
                          {entry.ip ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-on-surface-variant">
                          {Object.keys(metadata).length > 0 && (
                            <span className="font-mono text-body-s text-on-surface-variant">
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
              className="text-label-l text-primary hover:underline"
            >
              Previous
            </Link>
          ) : (
            <span className="text-label-l text-on-surface-variant/50">Previous</span>
          )}
          <span className="text-body-s text-on-surface-variant">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page + 1) })}`}
              className="text-label-l text-primary hover:underline"
            >
              Next
            </Link>
          ) : (
            <span className="text-label-l text-on-surface-variant/50">Next</span>
          )}
        </nav>
      )}
    </div>
  );
}
