'use client';

/**
 * Manage one-time invite links for a single event type.
 *
 * Two interactions:
 *   - Generate: opens a modal with an optional note. On success the modal
 *     swaps to a "copy this URL once" view — the raw token is surfaced
 *     here and never again. Closing the modal flushes it from memory.
 *   - Revoke: soft-deletes an unused invite. Already-used links can't be
 *     unburned, so we only show revoke for unused rows.
 *
 * Status pills (unused/used/revoked/expired) are derived server-side so
 * this component can stay presentation-only.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createInvite,
  inviteKeys,
  listInvites,
  revokeInvite,
  type CreatedInvite,
  type InviteListItem,
} from '@/lib/api/event-types';

interface Props {
  eventTypeId: string;
}

export function InviteLinksPanel({ eventTypeId }: Props) {
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [note, setNote] = useState('');
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const invitesQuery = useQuery({
    queryKey: inviteKeys.list(eventTypeId),
    queryFn: () => listInvites(eventTypeId),
  });

  const createMutation = useMutation({
    mutationFn: (n: string | undefined) => createInvite(eventTypeId, n ? { note: n } : {}),
    onSuccess: (data) => {
      setCreatedInvite(data);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: inviteKeys.list(eventTypeId) });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not create invite');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(eventTypeId, inviteId),
    onSuccess: () => {
      toast.success('Link revoked');
      void queryClient.invalidateQueries({ queryKey: inviteKeys.list(eventTypeId) });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not revoke invite');
    },
  });

  const invites = invitesQuery.data?.invites ?? [];

  async function handleCopy() {
    if (!createdInvite) return;
    try {
      await navigator.clipboard.writeText(createdInvite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(`Could not copy. Copy manually: ${createdInvite.url}`);
    }
  }

  function closeDialog() {
    setGenerateOpen(false);
    // Defer clearing the raw token until after the dialog closes so the
    // close animation doesn't render an empty modal.
    setTimeout(() => {
      setCreatedInvite(null);
      setNote('');
      setCopied(false);
    }, 200);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Share links</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One-time invite URLs that work for exactly one booking. After the booking is made the link burns out, even if it’s later cancelled.
          </p>
        </div>
        <Button onClick={() => setGenerateOpen(true)} size="sm">
          <Plus className="h-4 w-4" />
          New link
        </Button>
      </div>

      {invitesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : invites.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <Link2 className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">No invite links yet.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {invites.map((invite, idx) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              isFirst={idx === 0}
              onRevoke={() => revokeMutation.mutate(invite.id)}
              revoking={revokeMutation.isPending && revokeMutation.variables === invite.id}
            />
          ))}
        </ul>
      )}

      <Dialog open={generateOpen} onOpenChange={(open) => (open ? setGenerateOpen(true) : closeDialog())}>
        <DialogContent>
          {createdInvite ? (
            <>
              <DialogHeader>
                <DialogTitle>Copy this link now</DialogTitle>
                <DialogDescription>
                  This is the only time we’ll show the URL. Anyone with the link can book once.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-stretch gap-2">
                <Input readOnly value={createdInvite.url} className="font-mono text-xs" />
                <Button variant="outline" onClick={handleCopy} aria-label="Copy link">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <DialogFooter>
                <Button onClick={closeDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Generate a one-time link</DialogTitle>
                <DialogDescription>
                  Add an optional note so you can tell your invites apart later.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-note">Note (optional)</Label>
                <Input
                  id="invite-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Sarah at Acme"
                  maxLength={200}
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createMutation.mutate(note.trim() || undefined)}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? 'Generating…' : 'Generate'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function InviteRow({
  invite,
  isFirst,
  onRevoke,
  revoking,
}: {
  invite: InviteListItem;
  isFirst: boolean;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const statusStyle: Record<InviteListItem['status'], string> = {
    unused: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    used: 'bg-muted text-muted-foreground',
    revoked: 'bg-destructive/10 text-destructive',
    expired: 'bg-muted text-muted-foreground',
  };

  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 ${isFirst ? '' : 'border-t border-border'}`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {invite.note?.trim() || <span className="italic text-muted-foreground">No note</span>}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusStyle[invite.status]}`}
          >
            {invite.status}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {invite.status === 'used' && invite.usedBy
            ? `Used by ${invite.usedBy.bookerEmail} on ${new Date(invite.usedBy.startAt).toLocaleString()}`
            : invite.status === 'revoked' && invite.revokedAt
              ? `Revoked ${new Date(invite.revokedAt).toLocaleDateString()}`
              : `Created ${new Date(invite.createdAt).toLocaleDateString()}`}
        </div>
      </div>

      {invite.status === 'unused' && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRevoke}
          disabled={revoking}
          aria-label="Revoke link"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}
