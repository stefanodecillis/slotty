'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, Plus, Webhook, CheckCircle2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  testWebhook,
  updateWebhook,
  webhookKeys,
  type WebhookEndpoint,
} from '@/lib/api/webhooks';

const VALID_EVENTS = [
  { value: 'booking.created', label: 'Booking created' },
  { value: 'booking.cancelled', label: 'Booking cancelled' },
  { value: 'booking.rescheduled', label: 'Booking rescheduled' },
  { value: 'booking.no_show', label: 'Booking no-show' },
];

function generateRandomSecret(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function WebhooksPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createUrl, setCreateUrl] = useState('');
  const [createSecret, setCreateSecret] = useState('');
  const [createEvents, setCreateEvents] = useState<string[]>(['booking.created']);
  const [createError, setCreateError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const endpointsQuery = useQuery({
    queryKey: webhookKeys.list(),
    queryFn: listWebhooks,
  });
  const endpoints: WebhookEndpoint[] = endpointsQuery.data?.data ?? [];
  const loading = endpointsQuery.isLoading;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: webhookKeys.all });
  };

  const createMutation = useMutation({
    mutationFn: createWebhook,
    onSuccess: () => {
      setShowCreate(false);
      setCreateUrl('');
      setCreateSecret('');
      setCreateEvents(['booking.created']);
      setSuccessMsg('Webhook endpoint created.');
      invalidate();
    },
    onError: (err) => {
      setCreateError(err instanceof Error ? err.message : 'Failed to create endpoint.');
    },
  });
  const saving = createMutation.isPending;

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateWebhook(id, { active }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: invalidate,
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testWebhook(id),
    onSuccess: () => setSuccessMsg('Test delivery enqueued.'),
  });

  function handleCreate() {
    if (!createUrl || !createSecret || createEvents.length === 0) {
      setCreateError('URL, secret, and at least one event are required.');
      return;
    }
    setCreateError('');
    createMutation.mutate({ url: createUrl, secret: createSecret, events: createEvents });
  }

  function handleToggle(id: string, active: boolean) {
    toggleMutation.mutate({ id, active });
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this webhook endpoint?')) return;
    deleteMutation.mutate(id);
  }

  function handleTest(id: string) {
    testMutation.mutate(id);
  }

  function toggleEvent(event: string) {
    setCreateEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link
        href="/admin/settings"
        className="mb-4 inline-flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to settings
      </Link>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Webhooks</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Get notified when bookings are created, cancelled, or rescheduled.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-4 w-4" />
          Add endpoint
        </Button>
      </header>

      {successMsg && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground">
          <CheckCircle2 className="h-5 w-5" />
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : endpoints.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-muted/50 px-6 py-16 text-center">
          <Webhook className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">No endpoints yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add an HTTPS endpoint and we'll POST a signed JSON payload there for every event.
          </p>
          <Button
            onClick={() => setShowCreate(true)}
            className="mt-2"
          >
            Add endpoint
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {endpoints.map((ep) => {
            let events: string[] = [];
            try { events = JSON.parse(ep.eventTypesJson) as string[]; } catch { /* ignore */ }
            const lastDelivery = ep.deliveries[0];
            const lastOk =
              lastDelivery?.status === 'success' || (lastDelivery?.responseCode ?? 500) < 400;
            return (
              <article
                key={ep.id}
                className="rounded-lg border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-2 w-2 shrink-0 rounded-full ${
                          ep.active ? 'bg-emerald-600' : 'bg-muted-foreground/50'
                        }`}
                        aria-hidden="true"
                      />
                      <p className="truncate font-mono text-base font-medium text-foreground">{ep.url}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {events.map((e) => (
                        <span
                          key={e}
                          className="rounded-full bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                    {lastDelivery && (
                      <p className="text-xs text-muted-foreground">
                        Last delivery:{' '}
                        <span className={lastOk ? 'text-emerald-600' : 'text-destructive'}>
                          {lastDelivery.status}
                          {lastDelivery.responseCode ? ` (${lastDelivery.responseCode})` : ''}
                        </span>
                        {' · '}
                        {new Date(lastDelivery.createdAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Switch
                      checked={ep.active}
                      onCheckedChange={(v) => handleToggle(ep.id, v)}
                      aria-label="Active"
                    />
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleTest(ep.id)}>
                        Test
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(ep.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogTitle>Add webhook endpoint</DialogTitle>
          <div className="flex flex-col gap-4 pb-4">
            <div className="grid gap-2">
              <Label htmlFor="webhookUrl">Endpoint URL</Label>
              <Input
                id="webhookUrl"
                type="url"
                value={createUrl}
                onChange={(e) => setCreateUrl(e.target.value)}
                placeholder="https://example.com/webhook"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Signing secret</Label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createSecret}
                  onChange={(e) => setCreateSecret(e.target.value)}
                  placeholder="Signing secret…"
                  className="flex-1 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-primary"
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setCreateSecret(generateRandomSecret())}
                >
                  Generate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Save this now — it won't be shown again.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-muted-foreground">Subscribe to events</p>
              <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3">
                {VALID_EVENTS.map((ev) => (
                  <label
                    key={ev.value}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={createEvents.includes(ev.value)}
                      onChange={() => toggleEvent(ev.value)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Adding…' : 'Add endpoint'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
