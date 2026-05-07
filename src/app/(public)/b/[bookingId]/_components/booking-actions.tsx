'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
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
 * - "Add to Calendar" downloads .ics with token attached.
 * - "Cancel" opens a dialog with an optional reason field.
 * - "Reschedule" links to the dedicated reschedule page.
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
      const res = await fetch(
        `/api/public/bookings/${bookingId}/cancel?t=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() || undefined }),
        },
      );
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
    <>
      <div className="flex flex-col gap-3 rounded-shape-xl border border-outline-variant/60 bg-surface-container-low p-5">
        <p className="text-label-l text-on-surface-variant">Manage booking</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={icsUrl} download>
            <Button
              variant="tonal"
              type="button"
              leadingIcon={
                <span className="material-symbols-outlined text-[18px]" aria-hidden>
                  calendar_add_on
                </span>
              }
            >
              Add to calendar
            </Button>
          </a>

          {tokenKind === 'reschedule' && (
            <Link href={rescheduleHref}>
              <Button
                variant="outlined"
                type="button"
                leadingIcon={
                  <span className="material-symbols-outlined text-[18px]" aria-hidden>
                    update
                  </span>
                }
              >
                Reschedule
              </Button>
            </Link>
          )}

          <Button
            variant="text"
            type="button"
            onClick={() => setCancelOpen(true)}
            className="text-error hover:bg-error/[0.08]"
          >
            Cancel booking
          </Button>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <Dialog.Content>
          <Dialog.Title>Cancel this booking?</Dialog.Title>
          <Dialog.Body>
            <p className="mb-4 text-body-m text-on-surface-variant">
              The organizer and any guests will be notified. This cannot be undone.
            </p>
            <TextField
              label="Reason (optional)"
              value={reason}
              onChange={setReason}
              placeholder="Anything you want the organizer to know"
            />
            {error && <p className="mt-2 text-body-s text-error">{error}</p>}
          </Dialog.Body>
          <Dialog.Actions>
            <Button
              variant="text"
              type="button"
              onClick={() => setCancelOpen(false)}
              disabled={submitting}
            >
              Keep booking
            </Button>
            <Button
              variant="filled"
              type="button"
              onClick={handleCancel}
              loading={submitting}
              disabled={submitting}
              className="bg-error text-on-error hover:bg-error/90"
            >
              Cancel booking
            </Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
