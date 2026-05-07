import Link from 'next/link';
import { redirect } from 'next/navigation';

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
            className="h-24 w-24 rounded-full border-2 border-outline-variant object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container shadow-sm">
            <span className="text-display-s select-none">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
        <h1 className="text-display-s text-on-background">{user.displayName}</h1>
        {bioHtml && (
          <div
            className="max-w-prose text-body-l text-on-surface-variant [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: bioHtml }}
          />
        )}
      </header>

      {/* Event type list */}
      <section className="w-full" aria-label="Available event types">
        {eventTypes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-shape-lg border border-outline-variant bg-surface-container-low px-6 py-14 text-center">
            <span
              className="material-symbols-outlined text-[40px] text-on-surface-variant"
              aria-hidden
            >
              calendar_today
            </span>
            <p className="text-body-l text-on-surface-variant">No bookable events yet.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-outline-variant/40">
            {eventTypes.map((et) => (
              <li key={et.id}>
                <Link
                  href={`/${et.slug}`}
                  className="group flex items-center gap-4 rounded-shape-sm px-3 py-4 transition-colors hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {/* Color dot */}
                  <span
                    aria-hidden
                    className="mt-0.5 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: et.color }}
                  />

                  {/* Title + duration */}
                  <div className="flex-1 min-w-0">
                    <p className="text-title-l text-on-surface">{et.title}</p>
                    <p className="mt-0.5 text-body-m text-on-surface-variant">
                      {durationLabel(et.durationMinutes)}
                    </p>
                  </div>

                  {/* Chevron — slides right on hover */}
                  <span
                    aria-hidden
                    className="material-symbols-outlined flex-shrink-0 text-[20px] text-on-surface-variant transition-transform duration-150 group-hover:translate-x-0.5"
                  >
                    chevron_right
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
