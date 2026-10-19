'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';

/** Shown on a group-poll link once the owner has booked the common time. */
export function PollConfirmedPanel({
  title,
  startIso,
  endIso,
}: {
  title: string;
  startIso: string;
  endIso: string;
}) {
  // Format in the visitor's timezone, which only the browser knows.
  const [when, setWhen] = useState<string | null>(null);
  useEffect(() => {
    const day = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(new Date(startIso));
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
    setWhen(`${day}, ${time.format(new Date(startIso))}–${time.format(new Date(endIso))}`);
  }, [startIso, endIso]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <CalendarCheck className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Time confirmed</h1>
      <p className="text-sm text-foreground">
        <span className="font-medium">{title}</span>
        {when ? <> · {when}</> : null}
      </p>
      <p className="text-sm text-muted-foreground">
        Everyone who answered the poll has been sent a calendar invitation.
      </p>
    </div>
  );
}
