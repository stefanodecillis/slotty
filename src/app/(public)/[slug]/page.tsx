import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';

import { BookingFlow } from './_components/booking-flow';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
}

function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
}

/**
 * Public booking page for a single event type.
 *
 * Hidden event types are still bookable here (private link). Archived types
 * 404 even with the URL.
 *
 * Password-gated event types render a placeholder note in Phase 6 (the full
 * password challenge flow ships in Phase 7 with the rest of booking).
 */
export default async function EventTypePage({ params }: PageProps) {
  const eventType = await db.eventType.findUnique({
    where: { slug: params.slug },
    include: {
      user: { select: { id: true, displayName: true, avatarPath: true, bio: true, timezone: true } },
      questions: { orderBy: { position: 'asc' } },
    },
  });

  if (!eventType || eventType.archived) notFound();

  // Sanitised by renderMarkdown via DOMPurify allowlist.
  const descriptionHtml = renderMarkdown(eventType.descriptionMd);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:py-16">
      <header className="flex flex-col items-center gap-3 text-center">
        {eventType.user.avatarPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/avatars/${eventType.user.avatarPath}`}
            alt={eventType.user.displayName}
            className="h-16 w-16 rounded-full border border-outline-variant object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
            <span className="text-title-l">
              {eventType.user.displayName.slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
        <p className="text-body-s text-on-surface-variant">{eventType.user.displayName}</p>
        <h1 className="text-headline-l text-on-background" style={{ color: eventType.color }}>
          {eventType.title}
        </h1>
        <p className="text-body-m text-on-surface-variant">
          {durationLabel(eventType.durationMinutes)}
        </p>
        {descriptionHtml && (
          <div
            className="max-w-prose text-body-m text-on-surface-variant [&_a]:text-primary"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          />
        )}
      </header>

      <BookingFlow
        slug={eventType.slug}
        title={eventType.title}
        durationMinutes={eventType.durationMinutes}
        eventTypeId={eventType.id}
        ownerTimezone={eventType.user.timezone}
        questions={eventType.questions.map((q) => ({
          id: q.id,
          label: q.label,
          helperText: q.helperText,
          kind: q.kind,
          required: q.required,
          optionsJson: q.optionsJson,
        }))}
        passwordRequired={Boolean(eventType.passwordHash)}
      />
    </div>
  );
}
