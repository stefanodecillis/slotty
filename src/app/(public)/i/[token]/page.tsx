import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Calendar, LinkIcon } from 'lucide-react';

import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';
import { resolveInviteByRawToken } from '@/lib/booking/invite';

import { BookingFlow } from '../../[slug]/_components/booking-flow';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { token: string };
}

/**
 * Public booking page accessed via a one-time invite token.
 *
 * Resolves the token → event type server-side, then renders the same
 * BookingFlow component the slug-keyed page uses, with the token threaded
 * through so the slot fetch and booking POST go through the invite-keyed
 * routes.
 *
 * Burned, revoked, expired, or unknown tokens render an "unavailable"
 * panel rather than 404'ing — that lets the recipient see the difference
 * between "I mistyped the URL" and "this link was already used", without
 * leaking which case applies to a casual visitor.
 */
export default async function InvitePage({ params }: PageProps) {
  const resolved = await resolveInviteByRawToken(params.token);

  if (!resolved.eventType || resolved.eventType.archived) {
    return <UnavailablePanel reason="not_found" />;
  }
  if (resolved.status !== 'ok') {
    return <UnavailablePanel reason={resolved.status} />;
  }

  const eventType = resolved.eventType;

  const [owner, brand] = await Promise.all([
    db.user.findUnique({
      where: { id: eventType.userId },
      select: { displayName: true, avatarPath: true, timezone: true, weekStart: true },
    }),
    eventType.brandId
      ? db.brand.findUnique({
          where: { id: eventType.brandId },
          select: {
            name: true,
            primaryColor: true,
            accentColor: true,
            logoPath: true,
          },
        })
      : Promise.resolve(null),
  ]);
  if (!owner) notFound();

  const descriptionHtml = renderMarkdown(eventType.descriptionMd);

  return (
    <BookingFlow
      slug={eventType.slug}
      title={eventType.title}
      color={eventType.color}
      durationMinutes={eventType.durationMinutes}
      descriptionHtml={descriptionHtml}
      eventTypeId={eventType.id}
      ownerTimezone={owner.timezone}
      ownerName={owner.displayName}
      ownerAvatarPath={owner.avatarPath}
      weekStart={owner.weekStart}
      maxGuests={eventType.maxGuests}
      questions={eventType.questions.map((q) => ({
        id: q.id,
        label: q.label,
        helperText: q.helperText,
        kind: q.kind,
        required: q.required,
        optionsJson: q.optionsJson,
      }))}
      // Invite mode bypasses the password gate server-side, so the banner is
      // hidden regardless of the underlying event type's passwordHash.
      passwordRequired={false}
      brand={brand}
      inviteToken={params.token}
    />
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await resolveInviteByRawToken(params.token);
  const eventType = resolved.eventType;
  if (!eventType || eventType.archived) return {};
  const brand = eventType.brandId
    ? await db.brand.findUnique({
        where: { id: eventType.brandId },
        select: { name: true, faviconPath: true },
      })
    : null;
  const titleSuffix = brand?.name ? ` — ${brand.name}` : '';
  return {
    title: `${eventType.title}${titleSuffix}`,
    icons: brand?.faviconPath ? { icon: brand.faviconPath } : undefined,
  };
}

function UnavailablePanel({
  reason,
}: {
  reason: 'not_found' | 'used' | 'expired' | 'revoked';
}) {
  const copy: Record<typeof reason, { title: string; body: string }> = {
    not_found: {
      title: 'Link not found',
      body: 'This invite link doesn’t look right. Double-check the URL or ask the sender to share a fresh one.',
    },
    used: {
      title: 'Link already used',
      body: 'This invite has already been booked. If you need to reschedule, use the management link from your confirmation email instead.',
    },
    expired: {
      title: 'Link expired',
      body: 'This invite link has expired. Ask the sender to share a new one.',
    },
    revoked: {
      title: 'Link revoked',
      body: 'This invite link is no longer active. Ask the sender to share a new one.',
    },
  };
  const { title, body } = copy[reason];

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        {reason === 'not_found' ? (
          <LinkIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
        ) : (
          <Calendar className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
