'use client';

/**
 * Participant view of a group availability poll (a one-time invitation in
 * "A group" mode).
 *
 *   - "Your availability": a day × time grid of the owner's free slots.
 *     Drag (mouse) or tap (touch / keyboard) to mark "Available" or
 *     "If needed". Optionally pre-filled from Google Calendar free/busy, or
 *     from a confirmation link the participant's AI assistant wrote — either
 *     only paints the grid; the participant checks it and saves.
 *   - "Everyone": how many people can make each time so far.
 *
 * The first save returns a personal token, kept in localStorage per invite
 * and offered as a personal link (`?p=`) so the answer can be changed later,
 * from any device. The token is only ever sent in a request header.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Copy, Users } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { emailLooksValid } from '@/components/ui/guest-chip-input';
import { ApiError } from '@/lib/api/http';
import {
  getPublicPoll,
  pollKeys,
  submitPollResponse,
  type PublicPollView,
  type VoteValue,
} from '@/lib/api/group-poll';
import { hexToHsl, readableForegroundHsl } from '@/lib/brand/css';
import { decodeSpans, GOOGLE_FREE_PARAM } from '@/lib/group-poll/prefill';
import { hasHandoff, parsePollHandoff, votesFromHandoff, type HandoffRange } from '@/lib/agent/handoff';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils/cn';

import { TzSelector, getInitialBookerTz } from '../../../[slug]/_components/tz-selector';

interface Props {
  inviteToken: string;
  title: string;
  color: string;
  durationMinutes: number;
  descriptionHtml: string;
  ownerName: string;
  ownerAvatarPath: string | null;
  brand?: { name: string; primaryColor: string; accentColor: string; logoPath: string | null } | null;
}

const DAYS_PER_PAGE = 7;

function storageKey(inviteToken: string): string {
  return `slotty.poll.${inviteToken}`;
}

/** Name and email typed before leaving for Google, so they survive the round-trip. */
function draftKey(inviteToken: string): string {
  return `slotty.poll.draft.${inviteToken}`;
}

function writeDraft(inviteToken: string, draft: { name: string; email: string }): void {
  try {
    window.sessionStorage.setItem(draftKey(inviteToken), JSON.stringify(draft));
  } catch {
    /* storage disabled — they'll retype their name */
  }
}

function takeDraft(inviteToken: string): { name: string; email: string } | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(inviteToken));
    window.sessionStorage.removeItem(draftKey(inviteToken));
    const v = raw ? (JSON.parse(raw) as { name?: unknown; email?: unknown }) : null;
    return v && typeof v.name === 'string' && typeof v.email === 'string'
      ? { name: v.name, email: v.email }
      : null;
  } catch {
    return null;
  }
}

function readStoredToken(inviteToken: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(inviteToken));
  } catch {
    return null;
  }
}

function writeStoredToken(inviteToken: string, token: string | null): void {
  try {
    if (token) window.localStorage.setItem(storageKey(inviteToken), token);
    else window.localStorage.removeItem(storageKey(inviteToken));
  } catch {
    /* storage disabled — the personal link still works */
  }
}

export function GroupPollFlow(props: Props) {
  const { inviteToken, title, color, durationMinutes, descriptionHtml, ownerName, ownerAvatarPath, brand } =
    props;
  const queryClient = useQueryClient();

  const brandStyle: React.CSSProperties | undefined = brand
    ? ({
        '--primary': hexToHsl(brand.primaryColor),
        '--primary-foreground': readableForegroundHsl(brand.primaryColor),
        '--accent': hexToHsl(brand.accentColor),
        '--ring': hexToHsl(brand.primaryColor),
      } as React.CSSProperties)
    : undefined;

  const [tz, setTz] = useState('UTC');
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // A pre-fill waiting for the grid to load: free time from the Google
  // import, or an AI assistant's confirmation link (lib/agent/handoff.ts).
  const [prefill, setPrefill] = useState<{
    via: 'google' | 'agent';
    ranges: HandoffRange[];
    name: string | null;
    email: string | null;
  } | null>(null);

  // Pick up the timezone, a personal link (?p=) and a Google round-trip
  // result (?google=), then clean the URL so tokens don't linger in history.
  useEffect(() => {
    const url = new URL(window.location.href);
    const link = hasHandoff(url.hash) ? parsePollHandoff(url.hash) : null;
    setTz(link?.timezone && isValidTimeZone(link.timezone) ? link.timezone : getInitialBookerTz());
    const fromLink = url.searchParams.get('p');
    if (fromLink) writeStoredToken(inviteToken, fromLink);
    setParticipantToken(fromLink ?? readStoredToken(inviteToken));
    const google = url.searchParams.get('google');
    const draft = google ? takeDraft(inviteToken) : null;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (link) {
      setPrefill({ via: 'agent', ranges: link.ranges, name: link.name, email: link.email });
      url.hash = '';
    }
    if (google === 'ok') {
      const ranges = decodeSpans(fragment.get(GOOGLE_FREE_PARAM)).map((s) => ({ ...s, value: 'yes' as const }));
      setPrefill({ via: 'google', ranges, name: draft?.name ?? null, email: draft?.email ?? null });
      url.hash = '';
    } else if (google === 'empty')
      toast.message('Google Calendar shows you busy at every time in this poll. Mark the times you can make by hand.');
    else if (google === 'denied') toast.message('Google Calendar import cancelled.');
    else if (google === 'failed') toast.error('Could not import from Google Calendar. You can still mark your times by hand.');
    if (fromLink || google) {
      url.searchParams.delete('p');
      url.searchParams.delete('google');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    setReady(true);
  }, [inviteToken]);

  const query = useQuery({
    queryKey: pollKeys.public(inviteToken, tz, participantToken),
    queryFn: () => getPublicPoll(inviteToken, tz, participantToken),
    enabled: ready,
    retry: false,
    // Keep the grid on screen while switching timezone or after the first
    // save (new personal token → new key) instead of flashing "Loading…".
    placeholderData: (previous) => previous,
  });

  // A stale or foreign personal token: forget it and start fresh.
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 403) {
      writeStoredToken(inviteToken, null);
      setParticipantToken(null);
    }
  }, [query.error, inviteToken]);

  const data = query.data;

  // ── Draft answer ──
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [votes, setVotes] = useState<Map<string, VoteValue>>(new Map());
  const [dirty, setDirty] = useState(false);
  // Set once the grid holds a pre-fill; saved answers carry the label.
  const [via, setVia] = useState<'google' | 'agent' | null>(null);
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const key = `${participantToken ?? ''}:${data.me?.googleSyncedAt ?? ''}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    if (data.me) {
      setName(data.me.name);
      setEmail(data.me.email);
      setVotes(new Map(data.me.votes.map((v) => [v.startUtc, v.value])));
      setDirty(false);
    }
  }, [data, participantToken]);

  // Paint a pre-fill over whatever was there, as unsaved changes. Runs after
  // the saved answer (if any) has loaded above.
  useEffect(() => {
    if (!data || !prefill) return;
    setPrefill(null);
    if (prefill.name && (!data.me || prefill.via === 'agent')) setName(prefill.name);
    if (prefill.email && (!data.me || prefill.via === 'agent')) setEmail(prefill.email);
    const next = votesFromHandoff(
      data.days.flatMap((d) => d.slots),
      prefill.ranges,
    );
    const from = prefill.via === 'google' ? 'Google Calendar' : 'your assistant';
    if (next.size === 0) {
      if (prefill.ranges.length > 0) {
        toast.message(`None of the free times from ${from} match an open time. Mark your times by hand.`);
      }
      return;
    }
    setVotes(next);
    setVia(prefill.via);
    setDirty(true);
    toast.success(
      `Marked ${next.size} time${next.size === 1 ? '' : 's'} from ${from}. Check them, then press Save.`,
    );
  }, [data, prefill]);

  const [tab, setTab] = useState<'mine' | 'everyone'>('mine');
  const [brush, setBrush] = useState<VoteValue>('yes');
  const [page, setPage] = useState(0);

  const days = useMemo(() => (data?.days ?? []).filter((d) => d.slots.length > 0), [data]);
  const pageCount = Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE));
  const visibleDays = days.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const save = useMutation({
    mutationFn: () =>
      submitPollResponse(inviteToken, participantToken, {
        name: name.trim(),
        email: email.trim(),
        timezone: tz,
        votes: Array.from(votes, ([startUtc, value]) => ({ startUtc, value })),
        ...(via ? { via } : {}),
      }),
    onSuccess: (res) => {
      if (res.participantToken) {
        writeStoredToken(inviteToken, res.participantToken);
        loadedFor.current = `${res.participantToken}:${data?.me?.googleSyncedAt ?? ''}`;
        setParticipantToken(res.participantToken);
      }
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: pollKeys.all });
    },
  });

  function validateDetails(): boolean {
    if (!name.trim()) {
      toast.error('Please enter your name.');
      return false;
    }
    if (!emailLooksValid(email)) {
      toast.error('Please enter a valid email address. The meeting invitation is sent there.');
      return false;
    }
    return true;
  }

  async function handleSave() {
    if (!validateDetails()) return;
    try {
      await save.mutateAsync();
      toast.success('Saved. You can come back and change it any time.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your answer.');
    }
  }

  function handleGoogleImport() {
    // The import only pre-fills the grid; nothing is saved until Save. Keep
    // what was typed so far for when the browser comes back.
    writeDraft(inviteToken, { name, email });
    const fields: [string, string][] = [['inviteToken', inviteToken]];
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/public/polls/google/start';
    for (const [k, v] of fields) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  function setVote(startUtc: string, value: VoteValue | null) {
    setVotes((prev) => {
      if ((prev.get(startUtc) ?? null) === value) return prev;
      const next = new Map(prev);
      if (value) next.set(startUtc, value);
      else next.delete(startUtc);
      return next;
    });
    setDirty(true);
  }

  const personalLink =
    participantToken && typeof window !== 'undefined'
      ? `${window.location.origin}/i/${encodeURIComponent(inviteToken)}?p=${encodeURIComponent(participantToken)}`
      : null;

  const full = data ? !data.me && data.respondents.count >= data.maxParticipants : false;
  const headerImageSrc = brand?.logoPath ?? ownerAvatarPath;
  const headerLabel = brand?.name ?? ownerName;

  return (
    <div className="mx-auto flex max-w-5xl flex-col px-4 py-6 sm:px-6 sm:py-10" style={brandStyle}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
        <aside className="w-full shrink-0 sm:sticky sm:top-10 sm:w-56">
          <div className="flex flex-col gap-5 rounded-2xl border border-border/60 bg-muted/50 p-5">
            <div className="flex items-center gap-3">
              {headerImageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={headerImageSrc}
                  alt={headerLabel}
                  className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <span className="select-none text-base font-medium">
                    {headerLabel.slice(0, 1).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{headerLabel}</span>
                {brand ? <span className="truncate text-xs text-muted-foreground">{ownerName}</span> : null}
              </div>
            </div>
            <div className="border-t border-border/40" />
            <h1 className="text-lg font-semibold text-foreground" style={{ color: brand?.primaryColor ?? color }}>
              {title}
            </h1>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" aria-hidden />
                <span>{durationMinutes} min</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" aria-hidden />
                <span>
                  {data
                    ? `${data.respondents.count} ${data.respondents.count === 1 ? 'answer' : 'answers'} so far`
                    : 'Group poll'}
                </span>
              </div>
            </div>
            {descriptionHtml ? (
              <div
                className="text-xs text-muted-foreground [&_a]:text-primary [&_a]:underline"
                /* audit-skip: descriptionHtml is sanitized via renderMarkdown in the parent page.tsx */
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Mark every time you could make. {ownerName} picks the time that works for most
              people and everyone gets a calendar invitation.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {query.isLoading || !ready ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
          ) : query.error && !(query.error instanceof ApiError && query.error.status === 403) ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {query.error instanceof ApiError && query.error.status === 410
                ? 'This poll is closed.'
                : 'Could not load the poll. Please refresh the page.'}
            </p>
          ) : data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="poll-name">Your name</Label>
                  <Input
                    id="poll-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setDirty(true);
                    }}
                    autoComplete="name"
                    disabled={full}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="poll-email">Email</Label>
                  <Input
                    id="poll-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setDirty(true);
                    }}
                    autoComplete="email"
                    disabled={full}
                  />
                </div>
              </div>

              {full ? (
                <p className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  This poll is full ({data.maxParticipants} people). Ask {ownerName} if you should
                  still join.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex rounded-md border border-input p-0.5" role="tablist">
                  {(
                    [
                      ['mine', 'Your availability'],
                      ['everyone', `Everyone (${data.respondents.count})`],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={tab === value}
                      onClick={() => setTab(value)}
                      className={cn(
                        'rounded px-3 py-1.5 text-sm transition-colors',
                        tab === value ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted/60',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <TzSelector value={tz} onChange={setTz} />
              </div>

              {tab === 'mine' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Mark as</span>
                  {(
                    [
                      ['yes', 'Available'],
                      ['maybe', 'If needed'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={brush === value}
                      onClick={() => setBrush(value)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                        brush === value ? 'border-primary text-primary' : 'border-input text-muted-foreground',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'inline-block h-2.5 w-2.5 rounded-sm',
                          value === 'yes' ? 'bg-emerald-500' : 'bg-amber-400',
                        )}
                      />
                      {label}
                    </button>
                  ))}
                  {data.google.enabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={handleGoogleImport}
                      disabled={save.isPending || full}
                      title="Reads only your busy times from your primary Google Calendar, once. Nothing is stored."
                    >
                      <CalendarDays className="h-4 w-4" />
                      {data.me?.googleSyncedAt ? 'Re-import from Google Calendar' : 'Import from Google Calendar'}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {days.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
                  There are no open times in this poll right now.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      aria-label="Previous days"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {formatDay(visibleDays[0]!.date)} – {formatDay(visibleDays[visibleDays.length - 1]!.date)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={page >= pageCount - 1}
                      aria-label="Next days"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <AvailabilityGrid
                    days={visibleDays}
                    mode={tab}
                    votes={votes}
                    brush={brush}
                    disabled={full}
                    view={data}
                    onSet={setVote}
                    onReplace={(next) => {
                      setVotes(next);
                      setDirty(true);
                    }}
                  />
                </>
              )}

              {tab === 'everyone' ? <BestTimes view={data} /> : null}

              {tab === 'mine' && !full ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={save.isPending || votes.size === 0}
                    title={votes.size === 0 ? 'Mark at least one time you can make' : undefined}
                  >
                    <Check className="h-4 w-4" />
                    {save.isPending ? 'Saving…' : data.me ? 'Save changes' : 'Save my availability'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {votes.size === 0
                      ? 'Mark at least one time you can make'
                      : `${votes.size} time${votes.size === 1 ? '' : 's'} marked`}
                    {dirty ? ' · unsaved changes' : ''}
                  </span>
                </div>
              ) : null}

              {personalLink && data.me ? (
                <div className="flex flex-col gap-2 rounded-lg border border-input bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    Your personal link. Keep it to change your answer later, from any device:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-foreground">{personalLink}</code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        try {
                          await copyToClipboard(personalLink);
                          toast.success('Link copied.');
                        } catch {
                          toast.error('Could not copy the link.');
                        }
                      }}
                    >
                      <Copy className="h-4 w-4" /> Copy
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Grid
// ─────────────────────────────────────────────────────────────

interface GridProps {
  days: PublicPollView['days'];
  mode: 'mine' | 'everyone';
  votes: ReadonlyMap<string, VoteValue>;
  brush: VoteValue;
  disabled: boolean;
  view: PublicPollView;
  onSet: (startUtc: string, value: VoteValue | null) => void;
  onReplace: (next: Map<string, VoteValue>) => void;
}

interface DragState {
  value: VoteValue | null;
  origin: { day: number; row: number };
  /** Votes as they were when the drag started; the rectangle is re-applied on top. */
  base: Map<string, VoteValue>;
}

function AvailabilityGrid({ days, mode, votes, brush, disabled, view, onSet, onReplace }: GridProps) {
  // Mouse/pen: press and drag to paint the rectangle between the start cell
  // and the current one. Touch: tap to toggle, so the grid still scrolls
  // normally on phones. Keyboard: Enter/Space toggles.
  const drag = useRef<DragState | null>(null);
  const lastPointer = useRef<string | null>(null);

  useEffect(() => {
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const rows = useMemo(() => {
    const labels = new Set<string>();
    for (const d of days) for (const s of d.slots) labels.add(s.startInBookerTz);
    return Array.from(labels).sort();
  }, [days]);

  const byDay = useMemo(
    () => days.map((d) => new Map(d.slots.map((s) => [s.startInBookerTz, s]))),
    [days],
  );

  const respondents = Math.max(1, view.respondents.count);
  const editable = mode === 'mine' && !disabled;

  function toggled(startUtc: string): VoteValue | null {
    return votes.get(startUtc) === brush ? null : brush;
  }

  function paintTo(day: number, row: number) {
    const d = drag.current;
    if (!d) return;
    const next = new Map(d.base);
    const [d0, d1] = [Math.min(d.origin.day, day), Math.max(d.origin.day, day)];
    const [r0, r1] = [Math.min(d.origin.row, row), Math.max(d.origin.row, row)];
    for (let di = d0; di <= d1; di++) {
      for (let ri = r0; ri <= r1; ri++) {
        const slot = byDay[di]?.get(rows[ri]!);
        if (!slot) continue;
        if (d.value) next.set(slot.startUtc, d.value);
        else next.delete(slot.startUtc);
      }
    }
    onReplace(next);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse select-none text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-14 bg-background" />
            {days.map((d) => (
              <th key={d.date} className="min-w-[4.5rem] px-1 py-2 text-center font-medium text-foreground">
                {formatDay(d.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((label, rowIdx) => (
            <tr key={label}>
              <th className="sticky left-0 z-10 bg-background px-2 text-right font-normal text-muted-foreground">
                {label}
              </th>
              {byDay.map((slots, i) => {
                const slot = slots.get(label);
                if (!slot) return <td key={days[i]!.date} className="border-t border-border/40 bg-muted/30" />;
                const mine = votes.get(slot.startUtc) ?? null;
                const t = view.tally[slot.startUtc];
                const count = t ? t.yes + t.maybe : 0;
                const names = t?.yesNames
                  ? [...t.yesNames, ...(t.maybeNames ?? []).map((n) => `${n} (if needed)`)]
                  : null;
                const tooltip =
                  mode === 'mine'
                    ? `${label} — ${mine === 'yes' ? 'available' : mine === 'maybe' ? 'if needed' : 'not marked'}`
                    : `${label} — ${count} of ${view.respondents.count}${names?.length ? `: ${names.join(', ')}` : ''}`;
                return (
                  <td key={slot.startUtc} className="border-t border-border/40 p-0.5">
                    <button
                      type="button"
                      title={tooltip}
                      aria-label={tooltip}
                      aria-pressed={mode === 'mine' ? mine !== null : undefined}
                      disabled={!editable && mode === 'mine'}
                      onPointerDown={(e) => {
                        lastPointer.current = e.pointerType;
                        if (!editable || e.pointerType === 'touch') return;
                        e.preventDefault();
                        drag.current = {
                          value: toggled(slot.startUtc),
                          origin: { day: i, row: rowIdx },
                          base: new Map(votes),
                        };
                        paintTo(i, rowIdx);
                      }}
                      onPointerEnter={() => {
                        if (editable && drag.current) paintTo(i, rowIdx);
                      }}
                      onClick={() => {
                        const pointer = lastPointer.current;
                        lastPointer.current = null;
                        if (!editable || pointer === 'mouse' || pointer === 'pen') return;
                        onSet(slot.startUtc, toggled(slot.startUtc));
                      }}
                      className={cn(
                        'flex h-7 w-full items-center justify-center rounded-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        mode === 'mine'
                          ? mine === 'yes'
                            ? 'bg-emerald-500 text-white'
                            : mine === 'maybe'
                              ? 'bg-amber-400 text-amber-950'
                              : 'bg-muted/60 hover:bg-muted'
                          : count === 0
                            ? 'bg-muted/60'
                            : 'text-emerald-950 dark:text-emerald-50',
                        editable ? 'cursor-pointer' : 'cursor-default',
                      )}
                      style={
                        mode === 'everyone' && count > 0
                          ? {
                              backgroundColor: `rgb(16 185 129 / ${0.2 + 0.8 * ((t!.yes + 0.5 * t!.maybe) / respondents)})`,
                            }
                          : undefined
                      }
                    >
                      {mode === 'everyone' && count > 0 ? count : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BestTimes({ view }: { view: PublicPollView }) {
  const best = useMemo(() => {
    const starts = new Map<string, { date: string; label: string }>();
    for (const d of view.days) for (const s of d.slots) starts.set(s.startUtc, { date: d.date, label: s.startInBookerTz });
    return Object.entries(view.tally)
      .filter(([start]) => starts.has(start))
      .sort(([a, ta], [b, tb]) => tb.yes + tb.maybe - (ta.yes + ta.maybe) || tb.yes - ta.yes || a.localeCompare(b))
      .slice(0, 5)
      .map(([start, t]) => ({ start, ...starts.get(start)!, ...t }));
  }, [view]);

  if (view.respondents.count === 0) {
    return <p className="text-sm text-muted-foreground">Nobody has answered yet — be the first.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-foreground">Best times so far</h2>
      {best.length === 0 ? (
        <p className="text-sm text-muted-foreground">No time works for anyone yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {best.map((b) => (
            <li key={b.start} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-foreground">
                {formatDay(b.date)}, {b.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {b.yes + b.maybe} of {view.respondents.count}
                {b.yesNames ? ` · ${[...b.yesNames, ...(b.maybeNames ?? [])].join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.respondents.names ? (
        <p className="text-xs text-muted-foreground">Answered: {view.respondents.names.join(', ')}</p>
      ) : null}
    </div>
  );
}

function formatDay(isoDate: string): string {
  // The date is already in the participant's timezone; format it as a plain date.
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
