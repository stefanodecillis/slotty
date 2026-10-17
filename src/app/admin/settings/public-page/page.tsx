import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Globe2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { requireUserOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { getPublicUrl } from '@/lib/site-url/store';
import { PublicPageForm } from './public-page-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Public page settings' };

export default async function PublicPageSettingsPage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fsettings%2Fpublic-page');
  const [settings, publicUrl] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        publicPageShowName: true,
        publicPageShowAvatar: true,
        publicPageShowBio: true,
      },
    }),
    getPublicUrl(),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link
        href="/admin/settings"
        className="mb-6 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Settings
      </Link>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Public page</h1>
          <p className="mt-2 max-w-xl text-base text-muted-foreground">
            Choose how much of your profile visitors see on your homepage.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={publicUrl} target="_blank" rel="noopener noreferrer">
            View public page
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </header>

      <section className="mb-8 flex gap-3 rounded-xl bg-muted/50 p-5 sm:p-6">
        <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-medium text-foreground">Your homepage, your choice</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Profile details are hidden by default. Turn on only what you want to share here.
            Direct booking pages keep their event and brand identity.
          </p>
        </div>
      </section>

      <section aria-labelledby="profile-visibility-heading">
        <h2 id="profile-visibility-heading" className="mb-4 text-lg font-semibold text-foreground">
          Profile visibility
        </h2>
        <PublicPageForm settings={settings} />
      </section>
    </div>
  );
}
