'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';

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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-headline-m text-on-surface">Webhooks</h1>
          <p className="text-body-m text-on-surface-variant">
            Receive real-time notifications when bookings change.
          </p>
        </div>
        <Button variant="filled" onClick={() => setShowCreate(true)}>
          Add endpoint
        </Button>
      </header>

      {successMsg && (
        <div className="rounded-shape-s bg-secondary-container px-4 py-2 text-body-m text-on-secondary-container">
          {successMsg}
        </div>
      )}

      {loading ? (
        <p className="text-body-m text-on-surface-variant">Loading...</p>
      ) : endpoints.length === 0 ? (
        <Card variant="outlined">
          <Card.Content>
            <p className="py-6 text-center text-body-m text-on-surface-variant">
              No webhook endpoints configured.
            </p>
          </Card.Content>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {endpoints.map((ep) => {
            let events: string[] = [];
            try { events = JSON.parse(ep.eventTypesJson) as string[]; } catch { /* ignore */ }
            const lastDelivery = ep.deliveries[0];
            return (
              <Card key={ep.id} variant="filled" className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <p className="text-label-l text-on-surface truncate">{ep.url}</p>
                    <p className="text-body-s text-on-surface-variant">
                      Events: {events.join(', ')}
                    </p>
                    {lastDelivery && (
                      <p className="text-body-s text-on-surface-variant">
                        Last delivery: {lastDelivery.status}
                        {lastDelivery.responseCode ? ` (HTTP ${lastDelivery.responseCode})` : ''}
                        {' — '}
                        {new Date(lastDelivery.createdAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={ep.active}
                      onCheckedChange={(v) => void handleToggle(ep.id, v)}
                      aria-label="Active"
                    />
                    <Button variant="text" onClick={() => void handleTest(ep.id)}>
                      Test
                    </Button>
                    <Button variant="text" onClick={() => void handleDelete(ep.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
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
            <div className="flex flex-col gap-1">
              <label className="text-label-m text-on-surface-variant">Secret</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createSecret}
                  onChange={(e) => setCreateSecret(e.target.value)}
                  placeholder="Signing secret..."
                  className="flex-1 rounded-shape-xs border border-outline-variant bg-surface px-3 py-2 text-body-m text-on-surface font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                Copy and save this secret now — it won't be shown again.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-label-m text-on-surface-variant">Subscribe to events</p>
              {VALID_EVENTS.map((ev) => (
                <label key={ev.value} className="flex items-center gap-2 text-body-m text-on-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createEvents.includes(ev.value)}
                    onChange={() => toggleEvent(ev.value)}
                    className="h-4 w-4 rounded"
                  />
                  {ev.label}
                </label>
              ))}
            </div>
            {createError && (
              <p className="text-body-s text-error">{createError}</p>
            )}
          </div>
          <Dialog.Actions>
            <Button variant="text" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button variant="filled" onClick={() => void handleCreate()} disabled={saving}>
              {saving ? 'Saving...' : 'Add endpoint'}
            </Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}
