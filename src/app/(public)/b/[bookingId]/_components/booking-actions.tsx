'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarPlus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

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
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/50 p-5">
        <p className="text-sm font-medium text-muted-foreground">Manage booking</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={icsUrl} download>
            <Button variant="secondary" type="button">
              <CalendarPlus className="h-4 w-4" aria-hidden />
              Add to calendar
            </Button>
          </a>

          {tokenKind === 'reschedule' && (
            <Link href={rescheduleHref}>
              <Button variant="outline" type="button">
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reschedule
              </Button>
            </Link>
          )}

          <Button
            variant="ghost"
            type="button"
            onClick={() => setCancelOpen(true)}
            className="text-destructive hover:bg-destructive/10"
          >
            Cancel booking
          </Button>
        </div>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this booking?</DialogTitle>
            <DialogDescription>
              The organizer and any guests will be notified. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Anything you want the organizer to know"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setCancelOpen(false)}
              disabled={submitting}
            >
              Keep booking
            </Button>
            <Button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
