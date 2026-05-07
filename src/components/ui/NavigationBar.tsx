'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import type { NavItem } from './NavigationRail';

export interface NavigationBarProps {
  items: NavItem[];
  className?: string;
}

/**
 * M3 Navigation Bar — horizontal, sticky bottom, 80px tall.
 * Shown on mobile (< md) screens only. Active item uses filled icon.
 */
export function NavigationBar({ items, className }: NavigationBarProps) {
  return (
    <nav
      className={cn(
        'md:hidden fixed bottom-0 left-0 right-0 z-30 flex h-20 items-center justify-around border-t border-outline-variant bg-surface-container px-2',
        className,
      )}
      aria-label="Primary navigation"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'flex flex-col items-center gap-1 flex-1 py-2 text-label-s transition-colors',
            item.active ? 'text-on-secondary-container' : 'text-on-surface-variant',
          )}
          aria-current={item.active ? 'page' : undefined}
        >
          <span
            className={cn(
              'flex h-8 w-12 items-center justify-center rounded-full',
              item.active ? 'bg-secondary-container' : '',
            )}
          >
            <span
              className="material-symbols-outlined text-[22px]"
              style={item.active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
          </span>
          <span className="text-center leading-none">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
