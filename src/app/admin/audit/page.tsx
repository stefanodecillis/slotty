import { DateTime } from 'luxon';
import { Card } from '@/components/ui/Card';
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-display-s text-on-surface">Audit Log</h1>
        <p className="text-body-m text-on-surface-variant">
          {total} entries
        </p>
      </header>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap gap-3">
        <input
          type="text"
          name="action"
          defaultValue={action}
          placeholder="Filter by action..."
          className="rounded-shape-xs border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="rounded-shape-xs border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="rounded-shape-xs border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          className="rounded-shape-xs bg-primary px-4 py-2 text-label-l text-on-primary transition-opacity hover:opacity-80"
        >
          Filter
        </button>
        {(action || from || to) && (
          <a
            href="/admin/audit"
            className="rounded-shape-xs border border-outline-variant px-4 py-2 text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
          >
            Clear
          </a>
        )}
      </form>

      <Card variant="outlined">
        <Card.Content className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-m text-on-surface-variant">
              No audit log entries match your filters.
            </p>
          ) : (
            <table className="min-w-full text-body-s">
              <thead className="bg-surface-container-low text-label-m text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 text-left">Timestamp</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Actor</th>
                  <th className="px-4 py-3 text-left">Target</th>
                  <th className="px-4 py-3 text-left">IP</th>
                  <th className="px-4 py-3 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  let metadata: Record<string, unknown> = {};
                  try {
                    metadata = JSON.parse(entry.metadataJson) as Record<string, unknown>;
                  } catch { /* ignore */ }
                  return (
                    <tr key={entry.id} className="border-t border-outline-variant">
                      <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">
                        {DateTime.fromJSDate(entry.createdAt).toLocaleString(DateTime.DATETIME_MED)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-on-surface">{entry.action}</span>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{entry.actor}</td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        {entry.targetType && (
                          <span>
                            {entry.targetType}
                            {entry.targetId && (
                              <span className="font-mono text-on-surface-variant ml-1 text-body-xs">
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
                          <span className="font-mono text-body-xs text-on-surface-variant">
                            {JSON.stringify(metadata).slice(0, 80)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card.Content>
      </Card>

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-4">
          {page > 1 && (
            <a
              href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page - 1) })}`}
              className="text-label-l text-primary underline"
            >
              Previous
            </a>
          )}
          <span className="text-body-s text-on-surface-variant">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`/admin/audit?${new URLSearchParams({ ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(page + 1) })}`}
              className="text-label-l text-primary underline"
            >
              Next
            </a>
          )}
        </nav>
      )}
    </div>
  );
}
