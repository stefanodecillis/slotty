'use client';

/**
 * Calendar view of a group poll's answers for the owner: days across, times
 * down, each cell shaded by how many people can make it (a "maybe" counts
 * half). Times that work for everyone get a ring. Clicking a time picks it
 * for booking.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AdminPollResults } from '@/lib/api/group-poll';
import { cn } from '@/lib/utils/cn';

const DAYS_PER_PAGE = 7;

type Slot = AdminPollResults['slots'][number];

interface Props {
  data: AdminPollResults;
  timeZone: string;
  selected: string | null;
  onPick: (slot: Slot) => void;
}

function parts(iso: string, timeZone: string): { day: string; time: string; offset: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    offset: get('timeZoneName'),
  };
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export function PollHeatmap({ data, timeZone, selected, onPick }: Props) {
  const total = data.participants.length;
  const names = useMemo(
    () => new Map(data.participants.map((p) => [p.id, p.name])),
    [data.participants],
  );

  const { days, rows, grid } = useMemo(() => {
    const grid = new Map<string, Map<string, Slot>>();
    const rows = new Set<string>();
    for (const slot of data.slots) {
      const { day, time, offset } = parts(slot.startUtc, timeZone);
      const byTime = grid.get(day) ?? new Map<string, Slot>();
      // When clocks fall back the same wall time happens twice: keep both,
      // the second labelled with its UTC offset.
      const row = byTime.has(time) ? `${time} ${offset}` : time;
      rows.add(row);
      byTime.set(row, slot);
      grid.set(day, byTime);
    }
    return { days: Array.from(grid.keys()).sort(), rows: Array.from(rows).sort(), grid };
  }, [data.slots, timeZone]);

  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE));
  // Fewer days after a refetch (slots filled, window moved): stay in range.
  const page = Math.min(requestedPage, pageCount - 1);
  const visible = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);
  const visibleRows = rows.filter((r) => visible.some((d) => grid.get(d)?.has(r)));

  if (days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">You have no free times left in this poll.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            aria-label="Previous days"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
            disabled={page >= pageCount - 1}
            aria-label="Next days"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      <div className="max-h-80 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="w-12" />
              {visible.map((d) => (
                <th
                  key={d}
                  className="min-w-[3.5rem] px-1 py-2 text-center font-medium text-foreground"
                >
                  {dayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((time) => (
              <tr key={time}>
                <th className="px-2 text-right font-normal text-muted-foreground">{time}</th>
                {visible.map((d) => {
                  const slot = grid.get(d)?.get(time);
                  if (!slot) return <td key={d} className="p-0.5" />;
                  const can = slot.yes.length + slot.maybe.length;
                  const everyone = total > 0 && slot.no.length === 0;
                  const share = total > 0 ? (slot.yes.length + 0.5 * slot.maybe.length) / total : 0;
                  const who = [
                    ...slot.yes.map((id) => names.get(id) ?? 'Someone'),
                    ...slot.maybe.map((id) => `${names.get(id) ?? 'Someone'} (if needed)`),
                  ];
                  return (
                    <td key={d} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => onPick(slot)}
                        title={who.length > 0 ? who.join(', ') : 'Nobody can make it'}
                        aria-label={`${dayLabel(d)} ${time}: ${can} of ${total} can make it`}
                        aria-pressed={selected === slot.startUtc}
                        className={cn(
                          'flex h-6 w-full items-center justify-center rounded-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          can === 0
                            ? 'bg-muted/60 text-muted-foreground hover:bg-muted'
                            : 'text-emerald-950 dark:text-emerald-50',
                          everyone && 'ring-2 ring-inset ring-emerald-600',
                          selected === slot.startUtc && 'outline outline-2 outline-primary',
                        )}
                        style={
                          can > 0
                            ? { backgroundColor: `rgb(16 185 129 / ${0.15 + 0.85 * share})` }
                            : undefined
                        }
                      >
                        {can > 0 ? can : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Darker means more people can make it; a ring means everyone can. Hover for names, click to
        book.
      </p>
    </div>
  );
}
