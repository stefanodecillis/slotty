'use client';

import { useEffect, useMemo, useState } from 'react';

import { Select } from '@/components/ui/Select';

interface Props {
  value: string;
  onChange: (tz: string) => void;
}

const STORAGE_KEY = 'slotty.bookerTz';

/**
 * Time-zone picker for the booking flow. Defaults to the browser's resolved
 * tz, persists the choice in localStorage so returning bookers don't have to
 * re-pick. Searchable (zone names get long).
 */
export function TzSelector({ value, onChange }: Props) {
  const [zones, setZones] = useState<string[]>([]);

  useEffect(() => {
    const supported =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? ['UTC'];
    setZones(supported);
  }, []);

  // Persist on every change.
  useEffect(() => {
    if (!value) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage quota / disabled — ignore */
    }
  }, [value]);

  const options = useMemo(
    () =>
      zones.map((z) => ({
        value: z,
        label: z.replace(/_/g, ' '),
      })),
    [zones],
  );

  return (
    <Select
      label="Timezone"
      value={value}
      onValueChange={onChange}
      options={options}
      searchable
      placeholder="Select timezone"
    />
  );
}

/** Resolve the initial booker tz: localStorage > browser default > UTC. */
export function getInitialBookerTz(): string {
  if (typeof window === 'undefined') return 'UTC';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
