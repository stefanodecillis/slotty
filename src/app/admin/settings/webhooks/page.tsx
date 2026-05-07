'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { Skeleton } from '@/components/ui/Skeleton';

const VALID_EVENTS = [
  { value: 'booking.created', label: 'Booking created' },
  { value: 'booking.cancelled', label: 'Booking cancelled' },
  { value: 'booking.rescheduled', label: 'Booking rescheduled' },
  { value: 'booking.no_show', label: 'Booking no-show' },
];

interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypesJson: string;
  active: boolean;
  createdAt: string;
  deliveries: Array<{ status: string; createdAt: string; responseCode: number | null }>;
}

function generateRandomSecret(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createUrl, setCreateUrl] = useState('');
  const [createSecret, setCreateSecret] = useState('');
  const [createEvents, setCreateEvents] = useState<string[]>(['booking.created']);
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/webhooks');
      if (res.ok) {
        const data = await res.json() as { data: WebhookEndpoint[] };
        setEndpoints(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEndpoints();
  }, [loadEndpoints]);

  async function handleCreate() {
    if (!createUrl || !createSecret || createEvents.length === 0) {
      setCreateError('URL, secret, and at least one event are required.');
      return;
    }
    setSaving(true);
    setCreateError('');
    try {
      const res = await fetch('/api/admin/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: createUrl, secret: createSecret, events: createEvents }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setCreateError(err.error ?? 'Failed to create endpoint.');
        return;
      }
      setShowCreate(false);
      setCreateUrl('');
      setCreateSecret('');
      setCreateEvents(['booking.created']);
      setSuccessMsg('Webhook endpoint created.');
      await loadEndpoints();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/admin/webhooks/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    await loadEndpoints();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook endpoint?')) return;
    await fetch(`/api/admin/webhooks/${id}`, { method: 'DELETE' });
    await loadEndpoints();
  }

  async function handleTest(id: string) {
    const res = await fetch(`/api/admin/webhooks/${id}/test`, { method: 'POST' });
    if (res.ok) {
      setSuccessMsg('Test delivery enqueued.');
    }
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
        className="mb-4 inline-flex w-fit items-center gap-1 text-label-l text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Back to settings
      </Link>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-s text-on-background">Webhooks</h1>
          <p className="mt-1 text-body-l text-on-surface-variant">
            Get notified when bookings are created, cancelled, or rescheduled.
          </p>
        </div>
        <Button
          variant="filled"
          onClick={() => setShowCreate(true)}
          leadingIcon={<span className="material-symbols-outlined">add</span>}
        >
          Add endpoint
        </Button>
      </header>

      {successMsg && (
        <div className="mb-6 flex items-center gap-2 rounded-shape-md bg-secondary-container px-4 py-3 text-body-m text-on-secondary-container">
          <span className="material-symbols-outlined text-[20px]">check_circle</span>
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : endpoints.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-shape-md bg-surface-container-low px-6 py-16 text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant">
            webhook
          </span>
          <h2 className="text-title-l text-on-surface">No endpoints yet</h2>
          <p className="max-w-sm text-body-m text-on-surface-variant">
            Add an HTTPS endpoint and we'll POST a signed JSON payload there for every event.
          </p>
          <Button
            variant="filled"
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
                className="rounded-shape-md border border-outline-variant bg-surface p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-2 w-2 shrink-0 rounded-full ${
                          ep.active ? 'bg-tertiary' : 'bg-on-surface-variant/50'
                        }`}
                        aria-hidden="true"
                      />
                      <p className="truncate font-mono text-title-m text-on-surface">{ep.url}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {events.map((e) => (
                        <span
                          key={e}
                          className="rounded-full bg-surface-container-low px-2 py-0.5 text-label-s text-on-surface-variant"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                    {lastDelivery && (
                      <p className="text-body-s text-on-surface-variant">
                        Last delivery:{' '}
                        <span className={lastOk ? 'text-tertiary' : 'text-error'}>
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
                      onCheckedChange={(v) => void handleToggle(ep.id, v)}
                      aria-label="Active"
                    />
                    <div className="flex gap-1">
                      <Button variant="text" size="sm" onClick={() => void handleTest(ep.id)}>
                        Test
                      </Button>
                      <Button variant="text" size="sm" onClick={() => void handleDelete(ep.id)}>
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
        <Dialog.Content className="max-w-md">
          <Dialog.Title>Add webhook endpoint</Dialog.Title>
          <div className="flex flex-col gap-4 pb-4">
            <TextField
              label="Endpoint URL"
              type="url"
              value={createUrl}
              onChange={(v) => setCreateUrl(v)}
              placeholder="https://example.com/webhook"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-label-l text-on-surface-variant">Signing secret</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createSecret}
                  onChange={(e) => setCreateSecret(e.target.value)}
                  placeholder="Signing secret…"
                  className="flex-1 rounded-shape-sm border border-outline-variant bg-surface px-3 py-2 font-mono text-body-s text-on-surface outline-none transition-colors focus:border-primary"
                />
                <Button
                  variant="outlined"
                  type="button"
                  onClick={() => setCreateSecret(generateRandomSecret())}
                >
                  Generate
                </Button>
              </div>
              <p className="text-body-s text-on-surface-variant">
                Save this now — it won't be shown again.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-label-l text-on-surface-variant">Subscribe to events</p>
              <div className="flex flex-col gap-1 rounded-shape-sm bg-surface-container-low p-3">
                {VALID_EVENTS.map((ev) => (
                  <label
                    key={ev.value}
                    className="flex cursor-pointer items-center gap-2 rounded-shape-xs px-2 py-1.5 text-body-m text-on-surface transition-colors hover:bg-surface-container"
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
              <p className="text-body-s text-error">{createError}</p>
            )}
          </div>
          <Dialog.Actions>
            <Button variant="text" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button variant="filled" onClick={() => void handleCreate()} loading={saving} disabled={saving}>
              Add endpoint
            </Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}
