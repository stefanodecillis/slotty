import { DateTime } from 'luxon';
import { db } from '@/lib/db';

interface IcsEvent {
  summary: string;
  dtstart: Date;
  dtend?: Date;
}

// ──────────────────────────────────────────────────
// Minimal hand-rolled ICS parser
// ──────────────────────────────────────────────────

function unfoldLines(raw: string): string[] {
  // RFC 5545 line folding: continuation lines start with a space or tab
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '') // unfold
    .split('\n');
}

function parseIcsDate(value: string): Date | null {
  // DATE-TIME: 20260101T090000Z  or  20260101T090000 (floating)
  // DATE:      20260101
  const dateTimeRe = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
  const dateRe = /^(\d{4})(\d{2})(\d{2})$/;

  const dtm = dateTimeRe.exec(value);
  if (dtm) {
    const [, yr, mo, da, hh, mm, ss, z] = dtm;
    const zone = z === 'Z' ? 'utc' : 'local';
    const dt = DateTime.fromObject(
      {
        year: parseInt(yr!, 10),
        month: parseInt(mo!, 10),
        day: parseInt(da!, 10),
        hour: parseInt(hh!, 10),
        minute: parseInt(mm!, 10),
        second: parseInt(ss!, 10),
      },
      { zone },
    );
    return dt.isValid ? dt.toUTC().toJSDate() : null;
  }

  const dm = dateRe.exec(value);
  if (dm) {
    const [, yr, mo, da] = dm;
    const dt = DateTime.utc(parseInt(yr!, 10), parseInt(mo!, 10), parseInt(da!, 10));
    return dt.isValid ? dt.toJSDate() : null;
  }

  return null;
}

function parseIcs(text: string): IcsEvent[] {
  const lines = unfoldLines(text);
  const events: IcsEvent[] = [];

  let inEvent = false;
  let summary = '';
  let dtstart: Date | null = null;
  let dtend: Date | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (upper === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = '';
      dtstart = null;
      dtend = null;
      continue;
    }

    if (upper === 'END:VEVENT') {
      if (inEvent && dtstart) {
        events.push({ summary, dtstart, dtend: dtend ?? undefined });
      }
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    // Split on first colon (ignore property parameters for simplicity)
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const propRaw = line.slice(0, colonIdx).toUpperCase();
    const value = line.slice(colonIdx + 1).trim();

    // Strip parameters (e.g. DTSTART;VALUE=DATE becomes DTSTART)
    const prop = propRaw.split(';')[0];

    if (prop === 'SUMMARY') {
      summary = line.slice(colonIdx + 1).trim();
    } else if (prop === 'DTSTART') {
      dtstart = parseIcsDate(value);
    } else if (prop === 'DTEND') {
      dtend = parseIcsDate(value);
    }
  }

  return events;
}

// ──────────────────────────────────────────────────
// URL validation
// ──────────────────────────────────────────────────

function validateIcalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  const proto = parsed.protocol.toLowerCase();
  if (proto !== 'https:' && proto !== 'http:') {
    throw new Error(`URL scheme "${parsed.protocol}" is not allowed; use https:// or http://`);
  }
}

// ──────────────────────────────────────────────────
// Import holidays
// ──────────────────────────────────────────────────

export async function importHolidaysFromIcal(
  scheduleId: string,
  icalUrl: string,
  year: number,
): Promise<{ imported: number; skipped: number }> {
  validateIcalUrl(icalUrl);

  // Fetch with a 10-second timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let text: string;
  try {
    const res = await fetch(icalUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch iCal feed: HTTP ${res.status}`);
    }
    text = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const events = parseIcs(text);

  // Filter to the requested year
  const yearEvents = events.filter((ev) => {
    const dt = DateTime.fromJSDate(ev.dtstart, { zone: 'utc' });
    return dt.year === year;
  });

  // Load existing overrides for this schedule in the year to skip
  const yearStart = DateTime.utc(year, 1, 1).toJSDate();
  const yearEnd = DateTime.utc(year, 12, 31).toJSDate();

  const existing = await db.dateOverride.findMany({
    where: {
      scheduleId,
      date: { gte: yearStart, lte: yearEnd },
    },
    select: { date: true, source: true },
  });

  // Build sets of dates already covered
  const holidayDates = new Set<string>();
  const manualDates = new Set<string>();
  for (const ov of existing) {
    const key = DateTime.fromJSDate(ov.date, { zone: 'utc' }).toISODate() ?? '';
    if (ov.source === 'holiday-import') holidayDates.add(key);
    else manualDates.add(key);
  }

  let imported = 0;
  let skipped = 0;

  for (const ev of yearEvents) {
    const dt = DateTime.fromJSDate(ev.dtstart, { zone: 'utc' }).startOf('day');
    const key = dt.toISODate() ?? '';

    // Skip if there is already a holiday-import override for this date
    if (holidayDates.has(key)) {
      skipped++;
      continue;
    }

    // Never replace a manual override
    if (manualDates.has(key)) {
      skipped++;
      continue;
    }

    const normalised = dt.toJSDate();

    await db.dateOverride.create({
      data: {
        scheduleId,
        date: normalised,
        isBlocked: true,
        source: 'holiday-import',
        label: ev.summary || null,
      },
    });

    holidayDates.add(key);
    imported++;
  }

  return { imported, skipped };
}
