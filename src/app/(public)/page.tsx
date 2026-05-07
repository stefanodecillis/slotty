import Link from 'next/link';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { Card } from '@/components/ui/Card';
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
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 sm:py-20">
      <header className="flex flex-col items-center gap-3 text-center">
        {user.avatarPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/avatars/${user.avatarPath}`}
            alt={user.displayName}
            className="h-20 w-20 rounded-full border border-outline-variant object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
            <span className="text-headline-m">{user.displayName.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
        <h1 className="text-headline-m text-on-background">{user.displayName}</h1>
        {bioHtml && (
          <div
            className="text-body-m text-on-surface-variant [&_a]:text-primary"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: bioHtml }}
          />
        )}
      </header>

      <section className="flex flex-col gap-3" aria-label="Available event types">
        {eventTypes.length === 0 ? (
          <Card variant="outlined">
            <Card.Content className="py-12 text-center text-body-m text-on-surface-variant">
              No bookable event types yet.
            </Card.Content>
          </Card>
        ) : (
          eventTypes.map((et) => (
            <Link
              key={et.id}
              href={`/${et.slug}`}
              className="block rounded-shape-md transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Card variant="elevated">
                <Card.Header>
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="mt-1 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: et.color }}
                    />
                    <div className="flex-1">
                      <h2 className="text-title-l text-on-surface">{et.title}</h2>
                      <p className="mt-0.5 text-body-s text-on-surface-variant">
                        {durationLabel(et.durationMinutes)}
                      </p>
                    </div>
                    <span
                      className="material-symbols-outlined text-on-surface-variant"
                      aria-hidden
                    >
                      chevron_right
                    </span>
                  </div>
                </Card.Header>
              </Card>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
