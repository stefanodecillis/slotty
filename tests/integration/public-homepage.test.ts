import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';

import PublicHomePage from '@/app/(public)/page';
import { GET as getPublicEventTypes } from '@/app/api/public/event-types/route';
import { db } from '@/lib/db';
import { _resetForTests as resetRateLimits } from '@/lib/ratelimit';

const privateProfile = {
  displayName: 'Private Owner Identity',
  avatarPath: '/uploads/avatars/private-owner.webp',
  bio: 'A **private biography** with [more information](https://example.com/about).',
};

type IdentityVisibility = {
  publicPageShowName: boolean;
  publicPageShowAvatar: boolean;
  publicPageShowBio: boolean;
};

async function createOwner(visibility: Partial<IdentityVisibility> = {}) {
  return db.user.create({
    data: {
      username: 'public-homepage-owner',
      passwordHash: 'placeholder',
      email: 'private-owner@example.com',
      ...privateProfile,
      ...visibility,
    },
  });
}

async function renderHomepage() {
  return renderToStaticMarkup(await PublicHomePage());
}

async function clearOwners() {
  // Owner deletion cascades through event types and their bookings; connected
  // accounts can then be deleted without violating destination foreign keys.
  await db.user.deleteMany({});
  await db.connectedAccount.deleteMany({});
}

beforeEach(async () => {
  await clearOwners();
  resetRateLimits();
});
afterEach(clearOwners);

describe('public homepage identity', () => {
  it('defaults to a quiet page without profile details, marketing copy, or empty meeting lists', async () => {
    const user = await createOwner();

    expect(user.publicPageShowName).toBe(false);
    expect(user.publicPageShowAvatar).toBe(false);
    expect(user.publicPageShowBio).toBe(false);

    const html = await renderHomepage();

    expect(html).toMatch(/<h1\b[^>]*>Scheduling<\/h1>/);
    expect(html).not.toContain(privateProfile.displayName);
    expect(html).not.toContain(privateProfile.avatarPath);
    expect(html).not.toContain('private biography');
    expect(html).not.toContain('private-owner@example.com');
    expect(html).not.toContain('No bookable events yet.');
    expect(html).not.toContain('aria-label="Available event types"');
    expect(html).not.toContain('Slotty');
    expect(html).not.toContain('Have a booking link?');
    expect(html).not.toContain('Open the link shared with you');
    expect(html).not.toMatch(/<(?:h2|ul|ol)\b/);

    // Ignore the decorative graphic and the semantic page heading. The
    // default homepage should have no other copy above its layout's footer.
    const visibleCopy = html
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<h1\b[^>]*>Scheduling<\/h1>/, '')
      .replace(/<[^>]*>/g, '')
      .trim();
    expect(visibleCopy).toBe('');
  });

  it('can publish the name independently of the avatar and biography', async () => {
    await createOwner({ publicPageShowName: true });

    const html = await renderHomepage();

    expect(html).toContain(privateProfile.displayName);
    expect(html).not.toContain(privateProfile.avatarPath);
    expect(html).not.toContain('private biography');
  });

  it('can publish the avatar without leaking the hidden name through alternative text', async () => {
    await createOwner({ publicPageShowAvatar: true });

    const html = await renderHomepage();

    expect(html).toContain(`src="${privateProfile.avatarPath}"`);
    expect(html).not.toContain(privateProfile.displayName);
    expect(html).not.toContain('private biography');
  });

  it('can publish a sanitized biography independently of the name and avatar', async () => {
    const user = await createOwner({ publicPageShowBio: true });
    await db.user.update({
      where: { id: user.id },
      data: { bio: `${privateProfile.bio}<script>alert('private-script')</script>` },
    });

    const html = await renderHomepage();

    expect(html).toContain('<strong>private biography</strong>');
    expect(html).toContain('href="https://example.com/about"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('private-script');
    expect(html).not.toContain(privateProfile.displayName);
    expect(html).not.toContain(privateProfile.avatarPath);
  });
});

describe('public homepage event types', () => {
  it('lists published events in display order on the homepage and API while excluding private offerings', async () => {
    const user = await createOwner();
    const account = await db.connectedAccount.create({
      data: {
        provider: 'google',
        googleUserEmail: 'homepage-calendar@example.com',
        accessTokenEnc: 'placeholder',
        refreshTokenEnc: 'placeholder',
        scopes: 'calendar',
        expiresAt: new Date(Date.now() + 3_600_000),
        calendars: {
          create: {
            googleCalendarId: 'homepage-calendar',
            name: 'Homepage calendar',
            isDestinationEligible: true,
          },
        },
      },
      include: { calendars: true },
    });
    const calendar = account.calendars[0]!;
    const destination = {
      userId: user.id,
      destinationAccountId: account.id,
      destinationCalendarId: calendar.id,
      locationKind: 'google_meet',
      durationMinutes: 30,
    };

    await db.eventType.createMany({
      data: [
        {
          ...destination,
          title: 'Second public conversation',
          slug: 'second-conversation',
          position: 2,
        },
        {
          ...destination,
          title: 'First public conversation',
          slug: 'first-conversation',
          position: 1,
          durationMinutes: 75,
        },
        { ...destination, title: 'Hidden conversation', slug: 'hidden-conversation', hidden: true },
        {
          ...destination,
          title: 'Archived conversation',
          slug: 'archived-conversation',
          archived: true,
        },
        {
          ...destination,
          title: 'One-time conversation',
          slug: 'one-time-conversation',
          isOneTime: true,
        },
        {
          ...destination,
          title: 'Invitation-only conversation',
          slug: 'invitation-only-conversation',
          inviteOnly: true,
        },
      ],
    });

    const html = await renderHomepage();

    expect(html).toContain('href="/first-conversation"');
    expect(html).toContain('href="/second-conversation"');
    expect(html.indexOf('First public conversation')).toBeLessThan(
      html.indexOf('Second public conversation'),
    );
    expect(html).toContain('1 hr 15 min');
    for (const title of [
      'Hidden conversation',
      'Archived conversation',
      'One-time conversation',
      'Invitation-only conversation',
    ]) {
      expect(html).not.toContain(title);
    }
    for (const slug of [
      'hidden-conversation',
      'archived-conversation',
      'one-time-conversation',
      'invitation-only-conversation',
    ]) {
      expect(html).not.toContain(`href="/${slug}"`);
    }
    expect(html).not.toContain(privateProfile.displayName);
    expect(html).not.toContain(privateProfile.avatarPath);
    expect(html).not.toContain('private biography');

    const response = await getPublicEventTypes(
      new NextRequest('http://localhost/api/public/event-types'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { eventTypes: Array<{ slug: string }> };
    expect(body.eventTypes.map((eventType) => eventType.slug)).toEqual([
      'first-conversation',
      'second-conversation',
    ]);
  });
});
