import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminBottomNav } from '@/components/admin/bottom-nav';
import { resolvePageLabel } from '@/components/admin/admin-nav-items';
import { AdminSidebar } from '@/components/admin/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const PUBLIC_ADMIN_PATHS = new Set<string>(['/admin/login']);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getCurrentSession();
  const headersList = headers();
  const pathname = headersList.get('x-pathname') ?? '';

  if (!user) {
    if (PUBLIC_ADMIN_PATHS.has(pathname)) return <>{children}</>;
    const next = pathname && pathname.startsWith('/admin') ? pathname : '/admin';
    redirect(`/admin/login?next=${encodeURIComponent(next)}`);
  }

  const initials = user.displayName
    .split(' ')
    .map((n) => n[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const pageLabel = resolvePageLabel(pathname);

  return (
    <div className="flex min-h-dvh">
      <AdminSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
          <h1 className="truncate text-base font-semibold md:text-lg">{pageLabel}</h1>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/admin/profile"
              className="flex items-center gap-2 rounded-full px-1 py-1 transition-colors hover:bg-accent"
              aria-label="View profile"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium md:inline">{user.displayName}</span>
            </Link>
            <form method="POST" action="/api/admin/logout">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>

      <AdminBottomNav />
    </div>
  );
}
