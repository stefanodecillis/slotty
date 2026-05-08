import {
  CalendarDays,
  CalendarClock,
  CalendarRange,
  History,
  LayoutDashboard,
  Settings,
  Shapes,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/bookings', label: 'Bookings', icon: CalendarDays },
  { href: '/admin/event-types', label: 'Event types', icon: Shapes },
  { href: '/admin/calendars', label: 'Calendars', icon: CalendarRange },
  { href: '/admin/availability', label: 'Availability', icon: CalendarClock },
  { href: '/admin/profile', label: 'Profile', icon: User },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit', icon: History },
];

export const ADMIN_BOTTOM_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_ITEMS.filter((i) =>
  ['/admin', '/admin/bookings', '/admin/event-types', '/admin/availability', '/admin/settings'].includes(i.href),
);

export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export const PAGE_TITLES: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/bookings': 'Bookings',
  '/admin/event-types': 'Event types',
  '/admin/calendars': 'Calendars',
  '/admin/availability': 'Availability',
  '/admin/profile': 'Profile',
  '/admin/settings': 'Settings',
  '/admin/settings/security': 'Security',
  '/admin/settings/webhooks': 'Webhooks',
  '/admin/audit': 'Audit log',
};

export function resolvePageLabel(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]!;
  const matches = Object.keys(PAGE_TITLES)
    .filter((p) => pathname.startsWith(p))
    .sort((a, b) => b.length - a.length);
  return matches[0] ? PAGE_TITLES[matches[0]]! : 'Admin';
}
