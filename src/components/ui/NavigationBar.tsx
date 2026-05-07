'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import type { NavItem } from './NavigationRail';

export interface NavigationBarProps extends React.HTMLAttributes<HTMLElement> {
  items: NavItem[];
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
 * M3 Navigation Bar — horizontal, sticky bottom, 80px tall.
 * Shown on mobile (< md) screens only.
 */
export const NavigationBar = React.forwardRef<HTMLElement, NavigationBarProps>(
  ({ items, className, pathname: pathnameProp, ...props }, ref) => {
    const clientPathname = usePathname();
    const pathname = clientPathname ?? pathnameProp ?? '';

    return (
      <nav
        ref={ref}
        className={cn(
          'md:hidden fixed bottom-0 left-0 right-0 z-30 flex h-20 items-center justify-around border-t border-outline-variant bg-surface-container px-2',
          className,
        )}
        aria-label="Primary navigation"
        {...props}
      >
        {items.map((item) => (
          <NavigationBarItem key={item.href} item={item} active={isActive(item, pathname)} />
        ))}
      </nav>
    );
  },
);
NavigationBar.displayName = 'NavigationBar';

interface NavigationBarItemProps {
  item: NavItem;
  active: boolean;
  asChild?: boolean;
}

const NavigationBarItem = React.forwardRef<HTMLAnchorElement, NavigationBarItemProps>(
  ({ item, active, asChild = false }, ref) => {
    const Comp = asChild ? Slot : Link;
    return (
      <Comp
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={item.href}
        className={cn(
          'flex flex-col items-center gap-1 flex-1 py-2 text-label-s transition-colors',
          active ? 'text-on-secondary-container' : 'text-on-surface-variant',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <span
          className={cn(
            'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
            active ? 'bg-secondary-container' : '',
          )}
        >
          <span
            className="material-symbols-outlined text-[22px]"
            style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
          >
            {item.icon}
          </span>
        </span>
        <span className="text-center leading-none">{item.label}</span>
      </Comp>
    );
  },
);
NavigationBarItem.displayName = 'NavigationBar.Item';

export { NavigationBarItem };
