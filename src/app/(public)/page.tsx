import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Clock3 } from 'lucide-react';

import { db } from '@/lib/db';
import { renderMarkdown } from '@/lib/markdown';
import { PassingTime } from './_components/passing-time';
import styles from './home.module.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: { absolute: 'Scheduling' },
  description: 'Meeting availability.',
};

function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} hr`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
}

/** Public homepage. Private meeting links remain available at their own URLs. */
export default async function PublicHomePage() {
  const user = await db.user.findFirst({
    select: {
      id: true,
      displayName: true,
      avatarPath: true,
      bio: true,
      publicPageShowName: true,
      publicPageShowAvatar: true,
      publicPageShowBio: true,
    },
  });
  if (!user) redirect('/setup');

  const eventTypes = await db.eventType.findMany({
    where: {
      userId: user.id,
      archived: false,
      hidden: false,
      isOneTime: false,
      inviteOnly: false,
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      durationMinutes: true,
      color: true,
      brand: { select: { primaryColor: true } },
    },
  });

  const hasEvents = eventTypes.length > 0;
  const avatarPath = user.publicPageShowAvatar ? user.avatarPath : null;
  // Only render and sanitize profile content the owner has chosen to publish.
  const bioHtml = user.publicPageShowBio ? renderMarkdown(user.bio) : '';
  const hasProfile = user.publicPageShowName || avatarPath || bioHtml;

  return (
    <div className={`${styles.page} ${hasEvents ? styles.withEvents : ''}`}>
      <div className={styles.shell}>
        <h1 className="sr-only">Scheduling</h1>
        {hasProfile && (
          <header className={styles.profile}>
            {avatarPath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarPath} alt="Profile photo" className={styles.avatar} />
            )}
            <div className={styles.profileContent}>
              {user.publicPageShowName && <p className={styles.profileName}>{user.displayName}</p>}
              {bioHtml && (
                <div
                  className={styles.bio}
                  // Sanitized by renderMarkdown's DOMPurify allowlist.
                  dangerouslySetInnerHTML={{ __html: bioHtml }}
                />
              )}
            </div>
          </header>
        )}

        <PassingTime />

        {hasEvents && (
          <section className={styles.meetings} aria-labelledby="meetings-title">
            <h2 id="meetings-title" className={styles.sectionHeading}>
              Meetings
            </h2>
            <ul className={styles.eventList}>
              {eventTypes.map((eventType) => (
                <li key={eventType.id}>
                  <Link href={`/${eventType.slug}`} className={styles.eventLink}>
                    <span
                      aria-hidden="true"
                      className={styles.eventColor}
                      style={{ backgroundColor: eventType.brand?.primaryColor ?? eventType.color }}
                    />
                    <div className={styles.eventDetails}>
                      <h3>{eventType.title}</h3>
                      <p>
                        <Clock3 size={13} aria-hidden="true" />
                        {durationLabel(eventType.durationMinutes)}
                      </p>
                    </div>
                    <ArrowUpRight size={20} aria-hidden="true" className={styles.eventArrow} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
