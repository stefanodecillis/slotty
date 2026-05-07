'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select } from '@/components/ui/Select';
import { useSnackbar } from '@/components/ui/Snackbar';

const GOOGLE_HOLIDAYS_PLACEHOLDER =
  'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics';

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = [currentYear - 1, currentYear, currentYear + 1].map((y) => ({
  value: String(y),
  label: String(y),
}));

interface HolidayImportProps {
  scheduleId: string;
}

export function HolidayImport({ scheduleId }: HolidayImportProps) {
  const [icalUrl, setIcalUrl] = useState('');
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(false);
  const { show } = useSnackbar();

  const handleImport = async () => {
    if (!icalUrl.trim()) {
      show({ message: 'Please enter an iCal URL' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/availability/holidays/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduleId, icalUrl: icalUrl.trim(), year: parseInt(year, 10) }),
      });

      const data = (await res.json()) as { error?: unknown; imported?: number; skipped?: number };

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Import failed');
      }

      show({
        message: `Imported ${data.imported ?? 0} holiday(s), skipped ${data.skipped ?? 0}`,
        duration: 6000,
      });
    } catch (err) {
      show({ message: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-m text-on-surface-variant">
        Import public holidays from an iCal feed. Existing manual overrides will not be
        replaced. Re-running the import is safe (idempotent).
      </p>

      <TextField
        label="iCal URL"
        value={icalUrl}
        onChange={(v) => setIcalUrl(v)}
        placeholder={GOOGLE_HOLIDAYS_PLACEHOLDER}
        helperText="Must be an https:// or http:// URL to a public .ics feed"
        type="url"
      />

      <div className="max-w-[160px]">
        <Select
          label="Year"
          value={year}
          onValueChange={setYear}
          options={YEAR_OPTIONS}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleImport} loading={loading} variant="tonal">
          Import holidays
        </Button>
      </div>
    </div>
  );
}
