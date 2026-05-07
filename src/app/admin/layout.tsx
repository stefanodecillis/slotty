import { Button } from '@/components/ui/Button';
import { BRAND } from '@/lib/brand';
import { getCurrentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Admin shell. Renders chrome (top bar + sign-out) only when there is an
 * active session. The login page lives under /admin/login and renders via
 * this layout too — when there's no session we strip the chrome so the
 * login page sits centered on a clean background.
 *
 * Per-page guards: every protected page calls `requireUserOrRedirect()` to
 * enforce auth. This avoids fragile header sniffing in the layout for the
 * login route exception.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getCurrentSession();

  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-outline-variant bg-surface px-6 py-3">
        <a href="/admin" className="text-title-l text-on-surface">
          {BRAND.name}
        </a>
        <form method="POST" action="/api/admin/logout">
          <Button type="submit" variant="text" size="default">
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
