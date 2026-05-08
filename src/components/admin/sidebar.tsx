'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { ADMIN_NAV_ITEMS, isNavItemActive } from './admin-nav-items';

/**
 * Desktop sidebar (≥md). Active state is derived purely from `usePathname()`,
 * so client-side navigation updates the highlighted item instantly.
 */
export function AdminSidebar() {
  const pathname = usePathname() ?? '';

  return (
    <aside className="hidden border-r bg-muted/40 md:flex md:w-60 md:shrink-0 md:flex-col">
      <div className="flex h-14 items-center border-b px-6">
        <Link href="/admin" className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            S
          </span>
          Slotty
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-1">
          {ADMIN_NAV_ITEMS.map((item) => {
            const active = isNavItemActive(item.href, pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
