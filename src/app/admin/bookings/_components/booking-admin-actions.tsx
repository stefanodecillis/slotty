'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';

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
import { bookingKeys, cancelBookingAdmin, setBookingNoShow } from '@/lib/api/bookings';

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
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [localNoShow, setLocalNoShow] = useState(noShow);

  const cancelMutation = useMutation({
    mutationFn: () => cancelBookingAdmin(bookingId, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Booking cancelled.');
      setCancelOpen(false);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    },
  });
  const cancelling = cancelMutation.isPending;

  const noShowMutation = useMutation({
    mutationFn: (next: boolean) => setBookingNoShow(bookingId, next),
    onSuccess: (_data, next) => {
      setLocalNoShow(next);
      toast.success(next ? 'Marked as no-show.' : 'No-show cleared.');
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
      router.refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    },
  });
  const togglingNoShow = noShowMutation.isPending;

  function doCancel() {
    cancelMutation.mutate();
  }

  function toggleNoShow(next: boolean) {
    noShowMutation.mutate(next);
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
