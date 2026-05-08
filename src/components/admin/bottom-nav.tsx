'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { ADMIN_BOTTOM_NAV_ITEMS, isNavItemActive } from './admin-nav-items';

/**
 * Mobile bottom nav (<md). Active state from `usePathname()`.
 */
export function AdminBottomNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav className="sticky bottom-0 z-30 grid grid-cols-5 border-t bg-background md:hidden" aria-label="Primary">
      {ADMIN_BOTTOM_NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item.href, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="truncate">{item.label.replace('Event types', 'Events')}</span>
          </Link>
        );
      })}
    </nav>
  );
}
