import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { NavigationRail } from '@/components/ui/NavigationRail';
import { NavigationBar } from '@/components/ui/NavigationBar';
import { BRAND } from '@/lib/brand';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

// Pages under /admin that the layout is allowed to render without an auth
// gate. Every other path forces a redirect to /admin/login.
const PUBLIC_ADMIN_PATHS = new Set<string>(['/admin/login']);

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/bookings', label: 'Bookings', icon: 'event_note' },
  { href: '/admin/event-types', label: 'Event types', icon: 'category' },
  { href: '/admin/calendars', label: 'Calendars', icon: 'calendar_today' },
  { href: '/admin/availability', label: 'Availability', icon: 'schedule' },
  { href: '/admin/profile', label: 'Profile', icon: 'person' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
  { href: '/admin/audit', label: 'Audit', icon: 'history' },
];

const PAGE_TITLES: Record<string, string> = {
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

function resolvePageLabel(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]!;
  // Match the longest known prefix.
  const matches = Object.keys(PAGE_TITLES)
    .filter((p) => pathname.startsWith(p))
    .sort((a, b) => b.length - a.length);
  return matches[0] ? PAGE_TITLES[matches[0]]! : 'Admin';
}

/**
 * Admin shell. Renders Navigation Rail (desktop) and Navigation Bar (mobile)
 * when there is an active session. The login page sits centered on a clean
 * background when there's no session.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getCurrentSession();

  // Determine active path from request headers.
  const headersList = headers();
  const pathname = headersList.get('x-pathname') ?? '';

  if (!user) {
    // The login page renders standalone. Every other /admin/* path requires
    // a session — redirect with the original path captured in `next` so the
    // user lands back where they tried to go after signing in.
    if (PUBLIC_ADMIN_PATHS.has(pathname)) {
      return <>{children}</>;
    }
    const next = pathname && pathname.startsWith('/admin') ? pathname : '/admin';
    redirect(`/admin/login?next=${encodeURIComponent(next)}`);
  }

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

  const pageLabel = resolvePageLabel(pathname);

  // Mobile-friendly nav has fewer items; pick the most-used.
  const bottomNavItems = navItems
    .filter((item) =>
      ['/admin', '/admin/bookings', '/admin/event-types', '/admin/availability', '/admin/settings'].includes(
        item.href,
      ),
    )
    .map((item) => ({ ...item, label: item.label.replace('Event types', 'Events') }));

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Navigation Rail — desktop */}
      <aside className="hidden md:flex sticky top-0 h-dvh w-20 shrink-0 flex-col items-stretch border-r border-outline-variant bg-surface">
        <Link
          href="/admin"
          className="flex h-16 items-center justify-center border-b border-outline-variant text-title-l font-medium text-primary"
          aria-label={`${BRAND.name} home`}
        >
          {BRAND.name.slice(0, 1).toUpperCase()}
        </Link>
        <div className="flex-1 overflow-y-auto">
          <NavigationRail items={navItems} className="!flex" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-outline-variant bg-background/85 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/admin"
              className="md:hidden text-title-l font-medium text-primary"
              aria-label={`${BRAND.name} home`}
            >
              {BRAND.name}
            </Link>
            <span
              className="hidden md:inline truncate text-title-l text-on-surface"
              aria-label="Current page"
            >
              {pageLabel}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/profile"
              className="flex items-center gap-2 rounded-full px-1 py-1 transition-colors hover:bg-surface-container-low"
              aria-label="View profile"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-label-m text-on-primary">
                {initials}
              </span>
              <span className="hidden text-label-l text-on-surface md:block">
                {user.displayName}
              </span>
            </Link>
            <form method="POST" action="/api/admin/logout">
              <Button type="submit" variant="text" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-8 md:px-10 md:pb-12">
          {children}
        </main>
      </div>

      {/* Navigation Bar — mobile */}
      <NavigationBar items={bottomNavItems} />
    </div>
  );
}
