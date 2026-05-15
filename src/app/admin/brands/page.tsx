import Link from 'next/link';
import { Plus, Palette } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Brands' };

export default async function BrandsPage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fbrands');

  const [brands, owner] = await Promise.all([
    db.brand.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'asc' }],
      include: { _count: { select: { eventTypes: true } } },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { defaultBrandId: true } }),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Brands</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Build a visual identity (logo, favicon, colors) and attach it to event types or
            one-time links. Each branded link gets its own look.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/brands/new">
            <Plus className="h-4 w-4" />
            New brand
          </Link>
        </Button>
      </header>

      {brands.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Palette className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-medium text-foreground">No brands yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first brand to customize how your booking pages look for different
            audiences.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link href="/admin/brands/new">
              <Plus className="h-4 w-4" />
              Create a brand
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {brands.map((b) => {
            const isDefault = owner?.defaultBrandId === b.id;
            return (
              <li key={b.id}>
                <Link
                  href={`/admin/brands/${b.id}`}
                  className="flex h-full items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <div className="relative shrink-0">
                    {b.logoPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.logoPath}
                        alt={`${b.name} logo`}
                        className="h-14 w-14 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-base font-semibold text-foreground"
                        style={{ backgroundColor: b.primaryColor, color: '#fff' }}
                      >
                        {b.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-foreground">
                        {b.name}
                      </h3>
                      {isDefault ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        aria-hidden
                        className="inline-block h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: b.primaryColor }}
                      />
                      <span className="font-mono">{b.primaryColor}</span>
                      <span
                        aria-hidden
                        className="ml-2 inline-block h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: b.accentColor }}
                      />
                      <span className="font-mono">{b.accentColor}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {b._count.eventTypes === 0
                        ? 'Not attached to any event type'
                        : `Attached to ${b._count.eventTypes} event type${b._count.eventTypes === 1 ? '' : 's'}`}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
