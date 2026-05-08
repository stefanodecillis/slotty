'use client';

import React, { useState } from 'react';
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
import { toast } from 'sonner';

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

  const handleImport = async () => {
    if (!icalUrl.trim()) {
      toast.error('Please enter an iCal URL');
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

      toast.success(`Imported ${data.imported ?? 0} holiday(s), skipped ${data.skipped ?? 0}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="grid gap-2">
          <Label htmlFor="icalUrl">iCal URL</Label>
          <Input
            id="icalUrl"
            type="url"
            value={icalUrl}
            onChange={(e) => setIcalUrl(e.target.value)}
            placeholder={GOOGLE_HOLIDAYS_PLACEHOLDER}
          />
          <p className="text-xs text-muted-foreground">https:// link to a public .ics feed</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="importYear">Year</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger id="importYear">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Existing manual overrides will not be replaced. Re-running the import is safe (idempotent).
      </p>

      <div className="flex justify-end">
        <Button onClick={handleImport} disabled={loading} variant="secondary">
          {loading ? 'Importing…' : 'Import holidays'}
        </Button>
      </div>
    </div>
  );
}
