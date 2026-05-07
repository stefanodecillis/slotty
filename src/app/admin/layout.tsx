import { headers } from 'next/headers';
import { Button } from '@/components/ui/Button';
import { NavigationRail } from '@/components/ui/NavigationRail';
import { NavigationBar } from '@/components/ui/NavigationBar';
import { BRAND } from '@/lib/brand';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/bookings', label: 'Bookings', icon: 'event_note' },
  { href: '/admin/event-types', label: 'Event Types', icon: 'category' },
  { href: '/admin/calendars', label: 'Calendars', icon: 'calendar_today' },
  { href: '/admin/availability', label: 'Availability', icon: 'schedule' },
  { href: '/admin/profile', label: 'Profile', icon: 'person' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
  { href: '/admin/audit', label: 'Audit Log', icon: 'history' },
];

/**
 * Admin shell. Renders Navigation Rail (desktop) and Navigation Bar (mobile)
 * when there is an active session. The login page sits centered on a clean
 * background when there's no session.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getCurrentSession();

  if (!user) {
    return <>{children}</>;
  }

  // Determine active path from request headers.
  const headersList = headers();
  const pathname = headersList.get('x-pathname') ?? '';

  const navItems = NAV_ITEMS.map((item) => ({
    ...item,
    active:
      item.href === '/admin'
        ? pathname === '/admin' || pathname === ''
        : pathname.startsWith(item.href),
  }));

  const initials = user.displayName
    .split(' ')
    .map((n) => n[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-outline-variant bg-surface px-4 py-3 md:px-6">
        <a href="/admin" className="text-title-l text-on-surface">
          {BRAND.name}
        </a>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-label-m text-on-primary">
            {initials}
          </div>
          <span className="hidden text-label-l text-on-surface-variant md:block">
            {user.displayName}
          </span>
          <form method="POST" action="/api/admin/logout">
            <Button type="submit" variant="text" size="default">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Navigation Rail — desktop */}
        <div className="hidden md:flex sticky top-0 h-[calc(100dvh-57px)] overflow-y-auto border-r border-outline-variant bg-surface">
          <NavigationRail items={navItems} />
        </div>

        {/* Main content */}
        <main className="flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-8">{children}</main>
      </div>

      {/* Navigation Bar — mobile */}
      <NavigationBar items={navItems.slice(0, 5)} />
    </div>
  );
}
