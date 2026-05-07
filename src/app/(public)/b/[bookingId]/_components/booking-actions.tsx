'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';

interface Props {
  bookingId: string;
  token: string;
  tokenKind: 'cancel' | 'reschedule';
}

/**
 * Self-service controls for the booking management page.
 *
 * - "Add to Calendar" downloads the .ics with the same token attached so the
 *   server can authenticate the request.
 * - "Cancel" opens a dialog with an optional reason field, then POSTs to
 *   /api/public/bookings/[id]/cancel.
 * - "Reschedule" links to the dedicated reschedule page (if the token grants
 *   reschedule rights).
 */
export function BookingActions({ bookingId, token, tokenKind }: Props) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icsUrl = `/api/public/bookings/${bookingId}/ics?t=${encodeURIComponent(token)}`;
  const rescheduleHref = `/b/${bookingId}/reschedule?t=${encodeURIComponent(token)}`;

  async function handleCancel() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/bookings/${bookingId}/cancel?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card variant="outlined">
      <Card.Header>
        <h2 className="text-title-m text-on-surface">Manage</h2>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <a href={icsUrl} download>
            <Button variant="tonal" type="button">
              Add to Calendar
            </Button>
          </a>
          {tokenKind === 'reschedule' && (
            <Link href={rescheduleHref}>
              <Button variant="outlined" type="button">
                Reschedule
              </Button>
            </Link>
          )}
          <Button variant="text" type="button" onClick={() => setCancelOpen(true)}>
            Cancel booking
          </Button>
        </div>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <Dialog.Content>
            <Dialog.Title>Cancel booking</Dialog.Title>
            <Dialog.Body>
              <p className="mb-3 text-body-m text-on-surface-variant">
                The organizer and any guests will be notified by Google Calendar.
              </p>
              <TextField
                label="Reason (optional)"
                value={reason}
                onChange={setReason}
                placeholder="Anything you want the organizer to know"
              />
              {error && (
                <p className="mt-2 text-body-s text-error">{error}</p>
              )}
            </Dialog.Body>
            <Dialog.Actions>
              <Button variant="text" type="button" onClick={() => setCancelOpen(false)} disabled={submitting}>
                Keep booking
              </Button>
              <Button
                variant="filled"
                type="button"
                onClick={handleCancel}
                loading={submitting}
                disabled={submitting}
              >
                Cancel booking
              </Button>
            </Dialog.Actions>
          </Dialog.Content>
        </Dialog>
      </Card.Content>
    </Card>
  );
}
