'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils/cn';

export interface NavItem {
  href: string;
  label: string;
  icon: string; // Material Symbols icon name
  active?: boolean;
}

export interface NavigationRailProps {
  items: NavItem[];
  className?: string;
}

/**
 * M3 Navigation Rail — vertical, sticky, 80px wide.
 * Shown on md+ screens. Active item has filled icon indicator.
 */
export function NavigationRail({ items, className }: NavigationRailProps) {
  return (
    <nav
      className={cn(
        'hidden md:flex flex-col items-center gap-1 py-4 w-20 shrink-0',
        className,
      )}
      aria-label="Primary navigation"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            'flex flex-col items-center gap-1 w-full px-2 py-3 rounded-shape-l text-label-s transition-colors',
            item.active
              ? 'text-on-secondary-container'
              : 'text-on-surface-variant hover:text-on-surface',
          )}
          aria-current={item.active ? 'page' : undefined}
        >
          <span
            className={cn(
              'flex h-8 w-14 items-center justify-center rounded-full',
              item.active ? 'bg-secondary-container' : 'hover:bg-surface-container',
            )}
          >
            <span
              className={cn(
                'material-symbols-outlined text-[22px]',
                item.active && 'font-variation-settings: "FILL" 1',
              )}
              style={item.active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
          </span>
          <span className="text-center leading-tight">{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
