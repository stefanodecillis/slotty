import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { bookingId: string };
}

/**
 * Public booking confirmation page. Phase 7 will replace this stub with the
 * real "your booking is confirmed" experience plus reschedule / cancel
 * actions; for Phase 6 we just register the route so the URL space is
 * reserved.
 */
export default function BookingPage({ params }: PageProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <Card variant="filled">
        <Card.Header>
          <h1 className="text-headline-s text-on-surface">Booking page</h1>
        </Card.Header>
        <Card.Content>
          <p className="text-body-m text-on-surface-variant">Coming in Phase 7.</p>
          <p className="mt-2 text-body-s text-on-surface-variant">Reference: {params.bookingId}</p>
        </Card.Content>
      </Card>
    </div>
  );
}
