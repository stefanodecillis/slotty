'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

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
      toast.success('Booking cancelled.');
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
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
      toast.success(next ? 'Marked as no-show.' : 'No-show cleared.');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setTogglingNoShow(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Switch
          checked={localNoShow}
          onCheckedChange={(v) => toggleNoShow(v)}
          disabled={togglingNoShow}
        />
        No-show
      </label>
      <Button
        variant="outline"
        type="button"
        onClick={() => setCancelOpen(true)}
      >
        Cancel booking
      </Button>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel booking</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              The booker and any guests will be notified by Google Calendar.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="cancel-reason">Reason (optional)</Label>
              <Input
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setCancelOpen(false)}
              disabled={cancelling}
            >
              Keep booking
            </Button>
            <Button
              type="button"
              onClick={doCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
