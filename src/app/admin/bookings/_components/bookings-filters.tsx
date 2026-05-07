'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select } from '@/components/ui/Select';

interface Props {
  status: string;
  eventTypeId: string;
  from: string;
  to: string;
  q: string;
  eventTypes: { id: string; title: string }[];
}

/**
 * Filter bar for the admin booking list. Pure form-on-submit; we update the
 * URL query string and let the server component refetch.
 */
export function BookingsFilters(props: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(props.status);
  const [eventTypeId, setEventTypeId] = useState(props.eventTypeId);
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);
  const [q, setQ] = useState(props.q);

  function apply() {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (eventTypeId) next.set('eventTypeId', eventTypeId);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    if (q) next.set('q', q);
    router.push(`/admin/bookings${next.toString() ? `?${next}` : ''}`);
  }

  function clear() {
    setStatus('');
    setEventTypeId('');
    setFrom('');
    setTo('');
    setQ('');
    router.push('/admin/bookings');
  }

  const hasFilters = Boolean(status || eventTypeId || from || to || q);

  return (
    <div className="rounded-shape-md bg-surface-container-low p-4">
      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-3">
          <Select
            label="Status"
            value={status}
            onValueChange={setStatus}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'rescheduled', label: 'Rescheduled' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        <div className="md:col-span-3">
          <Select
            label="Event type"
            value={eventTypeId}
            onValueChange={setEventTypeId}
            options={[
              { value: '', label: 'All types' },
              ...props.eventTypes.map((e) => ({ value: e.id, label: e.title })),
            ]}
          />
        </div>
        <div className="md:col-span-2">
          <TextField label="From" value={from} onChange={setFrom} type="date" />
        </div>
        <div className="md:col-span-2">
          <TextField label="To" value={to} onChange={setTo} type="date" />
        </div>
        <div className="md:col-span-2">
          <TextField label="Search" value={q} onChange={setQ} placeholder="Name or email" />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {hasFilters && (
          <Button variant="text" type="button" onClick={clear}>
            Clear
          </Button>
        )}
        <Button variant="filled" type="button" onClick={apply}>
          Apply filters
        </Button>
      </div>
    </div>
  );
}
