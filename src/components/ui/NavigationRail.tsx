'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export interface NavItem {
  href: string;
  label: string;
  /** Material Symbols icon name. */
  icon: string;
  /**
   * Optional explicit override. When omitted, active state is derived from
   * the current pathname (`usePathname()`).
   */
  active?: boolean;
}

export interface NavigationRailProps extends React.HTMLAttributes<HTMLElement> {
  items: NavItem[];
  /**
   * Server-rendered fallback pathname. Used when `usePathname()` is not yet
   * hydrated (which would otherwise return `null` in some edge cases).
   */
  pathname?: string;
}

function isActive(item: NavItem, pathname: string): boolean {
  if (item.active !== undefined) return item.active;
  if (item.href === '/admin') {
    return pathname === '/admin' || pathname === '';
  }
  return pathname.startsWith(item.href);
}

/**
 * M3 Navigation Rail — vertical, sticky, 80px wide.
 * Shown on md+ screens. Active item gets a filled icon inside a chip.
 */
export const NavigationRail = React.forwardRef<HTMLElement, NavigationRailProps>(
  ({ items, className, pathname: pathnameProp, ...props }, ref) => {
    const clientPathname = usePathname();
    const pathname = clientPathname ?? pathnameProp ?? '';

    return (
      <nav
        ref={ref}
        className={cn(
          'hidden md:flex flex-col items-center gap-1 py-4 w-20 shrink-0',
          className,
        )}
        aria-label="Primary navigation"
        {...props}
      >
        {items.map((item) => (
          <NavigationRailItem key={item.href} item={item} active={isActive(item, pathname)} />
        ))}
      </nav>
    );
  },
);
NavigationRail.displayName = 'NavigationRail';

interface NavigationRailItemProps {
  item: NavItem;
  active: boolean;
  /** When true, render via `<Slot>` so the child is the link element. */
  asChild?: boolean;
}

const NavigationRailItem = React.forwardRef<HTMLAnchorElement, NavigationRailItemProps>(
  ({ item, active, asChild = false }, ref) => {
    const Comp = asChild ? Slot : Link;
    return (
      <Comp
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={item.href}
        className={cn(
          'group relative flex flex-col items-center gap-1 w-full px-2 py-3 text-label-s transition-colors',
          active
            ? 'text-on-surface font-semibold'
            : 'text-on-surface-variant hover:text-on-surface',
        )}
        aria-current={active ? 'page' : undefined}
      >
        {/* Left-edge active indicator — a 3px vertical bar in primary. */}
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-full bg-primary"
          />
        )}
        <span
          className={cn(
            'flex h-8 w-14 items-center justify-center rounded-full transition-colors',
            active
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant group-hover:bg-surface-container-high',
          )}
        >
          <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
        </span>
        <span className="text-center leading-tight">{item.label}</span>
      </Comp>
    );
  },
);
NavigationRailItem.displayName = 'NavigationRail.Item';

const NavigationRailNamespace = Object.assign(NavigationRail, {
  Item: NavigationRailItem,
});

export { NavigationRailNamespace as NavigationRailWithItem, NavigationRailItem };
