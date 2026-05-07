import { notFound, redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';

import { BookingFlow } from './_components/booking-flow';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { slug: string };
}

// Reserved top-level slugs handled by other routes — never treat as event types.
const RESERVED_SLUGS = new Set([
  'admin',
  'setup',
  'api',
  'b',
  'avatars',
  '_next',
  'favicon.ico',
]);

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
 */
export default async function EventTypePage({ params }: PageProps) {
  if (RESERVED_SLUGS.has(params.slug)) notFound();

  const eventType = await db.eventType.findUnique({
    where: { slug: params.slug },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarPath: true, bio: true, timezone: true } },
      questions: { orderBy: { position: 'asc' } },
    },
  });

  // If no event type matches but the slug equals the owner's username,
  // redirect to /. Calendly-style profile URL convenience for a single-user app.
  if (!eventType || eventType.archived) {
    const userByUsername = await db.user.findUnique({ where: { username: params.slug } });
    if (userByUsername) redirect('/');
    notFound();
  }

  // Sanitised by renderMarkdown via DOMPurify allowlist.
  const descriptionHtml = renderMarkdown(eventType.descriptionMd);

  return (
    <BookingFlow
      slug={eventType.slug}
      title={eventType.title}
      color={eventType.color}
      durationMinutes={eventType.durationMinutes}
      descriptionHtml={descriptionHtml}
      eventTypeId={eventType.id}
      ownerTimezone={eventType.user.timezone}
      ownerName={eventType.user.displayName}
      ownerAvatarPath={eventType.user.avatarPath}
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
  );
}
