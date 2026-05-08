'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** Owner's `timezoneSet` flag from the session. When true, this component is a no-op. */
  alreadySet: boolean;
}

/**
 * On the first admin visit (when `alreadySet === false`) detect the browser
 * timezone via Intl, POST it to `/api/admin/profile/timezone`, then refresh
 * server components so the new tz is visible everywhere. The endpoint itself
 * is idempotent and only writes when the flag is still false, so a duplicate
 * call from a stale tab is harmless.
 */
export function TimezoneAutodetect({ alreadySet }: Props) {
  const router = useRouter();
  const sentRef = useRef(false);

  useEffect(() => {
    if (alreadySet || sentRef.current) return;
    sentRef.current = true;

    const tz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {
        return '';
      }
    })();
    if (!tz) return;

    void fetch('/api/admin/profile/timezone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => {
        /* offline or blocked — try again next visit */
      });
  }, [alreadySet, router]);

  return null;
}
