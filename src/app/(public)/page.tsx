import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Calendar, ChevronRight } from 'lucide-react';

import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
}

/**
 * Public landing page. Lists every non-archived, non-hidden event type.
 *
 * On first run (no User row), redirects to /setup so admins can finish
 * onboarding before exposing booking links.
 */
export default async function PublicHomePage() {
  const user = await db.user.findFirst();
  if (!user) redirect('/setup');

  const eventTypes = await db.eventType.findMany({
    where: { userId: user.id, archived: false, hidden: false },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      durationMinutes: true,
      color: true,
      descriptionMd: true,
    },
  });

  // bioHtml is sanitized by renderMarkdown (DOMPurify allowlist).
  const bioHtml = renderMarkdown(user.bio);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-10 px-6 py-16 sm:py-24">
      {/* Hero */}
      <header className="flex flex-col items-center gap-4 text-center">
        {user.avatarPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarPath}
            alt={user.displayName}
            className="h-24 w-24 rounded-full border-2 border-border object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm">
            <span className="text-3xl font-semibold tracking-tight select-none">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{user.displayName}</h1>
        {bioHtml && (
          <div
            className="max-w-prose text-base text-muted-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: bioHtml }}
          />
        )}
      </header>

      {/* Event type list */}
      <section className="w-full" aria-label="Available event types">
        {eventTypes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/50 px-6 py-14 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="text-base text-muted-foreground">No bookable events yet.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border/40">
            {eventTypes.map((et) => (
              <li key={et.id}>
                <Link
                  href={`/${et.slug}`}
                  className="group flex items-center gap-4 rounded-md px-3 py-4 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {/* Color dot */}
                  <span
                    aria-hidden
                    className="mt-0.5 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: et.color }}
                  />

                  {/* Title + duration */}
                  <div className="flex-1 min-w-0">
                    <p className="text-lg font-semibold text-foreground">{et.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {durationLabel(et.durationMinutes)}
                    </p>
                  </div>

                  {/* Chevron — slides right on hover */}
                  <ChevronRight
                    aria-hidden
                    className="h-5 w-5 flex-shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
