'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
  const searchParams = useSearchParams();
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
    void searchParams; // referenced to keep filter state intentional
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

  return (
    <Card variant="outlined">
      <Card.Content className="grid gap-3 md:grid-cols-5">
        <Select
          label="Status"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: '', label: 'All' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'rescheduled', label: 'Rescheduled' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <Select
          label="Event type"
          value={eventTypeId}
          onValueChange={setEventTypeId}
          options={[
            { value: '', label: 'All' },
            ...props.eventTypes.map((e) => ({ value: e.id, label: e.title })),
          ]}
        />
        <TextField
          label="From"
          value={from}
          onChange={setFrom}
          type="date"
        />
        <TextField
          label="To"
          value={to}
          onChange={setTo}
          type="date"
        />
        <TextField
          label="Search"
          value={q}
          onChange={setQ}
          placeholder="name or email"
        />
        <div className="flex gap-2 md:col-span-5">
          <Button variant="filled" type="button" onClick={apply}>
            Apply
          </Button>
          <Button variant="text" type="button" onClick={clear}>
            Clear
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
