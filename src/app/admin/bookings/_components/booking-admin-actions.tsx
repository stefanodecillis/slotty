'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { Switch } from '@/components/ui/Switch';
import { useSnackbar } from '@/components/ui/Snackbar';

interface Props {
  bookingId: string;
  noShow: boolean;
}

/**
 * Admin-side controls for a single booking: cancel + no-show toggle.
 * Both actions go through the CSRF-guarded admin API. We refresh the route
 * after success so the server-rendered detail page reflects the new state.
 */
export function BookingAdminActions({ bookingId, noShow }: Props) {
  const router = useRouter();
  const { show } = useSnackbar();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [togglingNoShow, setTogglingNoShow] = useState(false);
  const [localNoShow, setLocalNoShow] = useState(noShow);

  async function doCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      show({ message: 'Booking cancelled.' });
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      show({ message: err instanceof Error ? err.message : 'Cancel failed' });
    } finally {
      setCancelling(false);
    }
  }

  async function toggleNoShow(next: boolean) {
    setTogglingNoShow(true);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noShow: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setLocalNoShow(next);
      show({ message: next ? 'Marked as no-show.' : 'No-show cleared.' });
      router.refresh();
    } catch (err) {
      show({ message: err instanceof Error ? err.message : 'Update failed' });
    } finally {
      setTogglingNoShow(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-label-l text-on-surface">
        <Switch
          checked={localNoShow}
          onCheckedChange={(v) => toggleNoShow(v)}
          disabled={togglingNoShow}
        />
        No-show
      </label>
      <Button
        variant="outlined"
        type="button"
        onClick={() => setCancelOpen(true)}
      >
        Cancel booking
      </Button>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <Dialog.Content>
          <Dialog.Title>Cancel booking</Dialog.Title>
          <Dialog.Body>
            <p className="mb-3 text-body-m text-on-surface-variant">
              The booker and any guests will be notified by Google Calendar.
            </p>
            <TextField label="Reason (optional)" value={reason} onChange={setReason} />
          </Dialog.Body>
          <Dialog.Actions>
            <Button variant="text" type="button" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep booking
            </Button>
            <Button variant="filled" type="button" onClick={doCancel} loading={cancelling} disabled={cancelling}>
              Cancel booking
            </Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}
