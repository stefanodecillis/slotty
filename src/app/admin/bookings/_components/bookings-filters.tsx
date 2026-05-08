'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-3 grid gap-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select
            value={status || '__all__'}
            onValueChange={(v) => setStatus(v === '__all__' ? '' : v)}
          >
            <SelectTrigger id="filter-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="rescheduled">Rescheduled</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-3 grid gap-1.5">
          <Label htmlFor="filter-event-type">Event type</Label>
          <Select
            value={eventTypeId || '__all__'}
            onValueChange={(v) => setEventTypeId(v === '__all__' ? '' : v)}
          >
            <SelectTrigger id="filter-event-type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {props.eventTypes.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 grid gap-1.5">
          <Label htmlFor="filter-from">From</Label>
          <Input
            id="filter-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="md:col-span-2 grid gap-1.5">
          <Label htmlFor="filter-to">To</Label>
          <Input
            id="filter-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="md:col-span-2 grid gap-1.5">
          <Label htmlFor="filter-search">Search</Label>
          <Input
            id="filter-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or email"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {hasFilters && (
          <Button variant="ghost" type="button" onClick={clear}>
            Clear
          </Button>
        )}
        <Button type="button" onClick={apply}>
          Apply filters
        </Button>
      </div>
    </div>
  );
}
