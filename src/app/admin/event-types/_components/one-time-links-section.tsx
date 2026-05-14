'use client';

/**
 * Renders the "pending one-time links" list on /admin/event-types.
 *
 * Each row pairs a one-time EventType with its single still-usable
 * BookingInvite. URLs aren't shown here — the raw token is unrecoverable
 * after the create dialog closes (only sha256 is stored). The admin can
 * see what's outstanding and revoke; to re-share, revoke + create a new link.
 */
import { useMemo } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  listOneTimeLinks,
  oneTimeLinkKeys,
  revokeInvite,
  type PendingOneTimeLink,
} from '@/lib/api/event-types';

interface Props {
  trigger?: React.ReactNode;
}

export function OneTimeLinksSection({ trigger }: Props) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: oneTimeLinkKeys.list(),
    queryFn: listOneTimeLinks,
  });

  const revokeMutation = useMutation({
    mutationFn: (vars: { eventTypeId: string; inviteId: string }) =>
      revokeInvite(vars.eventTypeId, vars.inviteId),
    onSuccess: () => {
      toast.success('Link revoked.');
      void queryClient.invalidateQueries({ queryKey: oneTimeLinkKeys.list() });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not revoke link.');
    },
  });

  const links = query.data?.links ?? [];

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">One-time links</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Single-use invite URLs. They disappear here once used or revoked.
          </p>
        </div>
        {trigger ? <div>{trigger}</div> : null}
      </header>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <Link2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No pending one-time links.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Click <strong>New one-time link</strong> above to generate one. URLs are shown only at
            creation time.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            URLs are shown only at creation. Revoke and create a new link to share again.
          </p>
          <ul className="overflow-hidden rounded-lg border border-border bg-card">
            {links.map((link, idx) => (
              <OneTimeLinkRow
                key={link.inviteId}
                link={link}
                isFirst={idx === 0}
                onRevoke={() =>
                  revokeMutation.mutate({ eventTypeId: link.eventTypeId, inviteId: link.inviteId })
                }
                revoking={
                  revokeMutation.isPending &&
                  revokeMutation.variables?.inviteId === link.inviteId
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface RowProps {
  link: PendingOneTimeLink;
  isFirst: boolean;
  onRevoke: () => void;
  revoking: boolean;
}

function OneTimeLinkRow({ link, isFirst, onRevoke, revoking }: RowProps) {
  const expiresLabel = useMemo(() => describeExpiry(link.expiresAt), [link.expiresAt]);
  const createdLabel = useMemo(() => describeAgo(link.createdAt), [link.createdAt]);

  return (
    <li
      className={`flex items-center gap-3 px-4 py-4 transition-colors hover:bg-muted/50 ${
        isFirst ? '' : 'border-t border-border'
      }`}
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: link.color }}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-medium text-foreground">{link.title}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            One-time
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{link.durationMinutes} min</span>
          <span aria-hidden="true">·</span>
          <span>Created {createdLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{expiresLabel}</span>
          {link.hiddenGuestsCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                +{link.hiddenGuestsCount} hidden guest
                {link.hiddenGuestsCount === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
        {link.note ? (
          <div className="mt-0.5 truncate text-xs italic text-muted-foreground">{link.note}</div>
        ) : null}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRevoke}
        disabled={revoking}
        aria-label="Revoke link"
        title="Revoke link"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function describeExpiry(iso: string | null): string {
  if (!iso) return 'no expiry';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `expires in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 1) return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  return 'expires soon';
}

function describeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return `${days}d ago`;
}
