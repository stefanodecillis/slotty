import { describe, it, expect } from 'bun:test';
import { generateIcs } from '@/lib/ics';

const FIXED_NOW = new Date('2026-05-07T10:00:00Z');

/** RFC 5545 section 3.1: a CRLF followed by a single space/tab is line folding
 *  for transmission only. Unfold before semantic checks. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

describe('generateIcs', () => {
  it('emits required RFC 5545 envelope', () => {
    const ics = generateIcs({
      uid: 'abc-123',
      summary: 'Test',
      start: new Date('2026-06-01T14:00:00Z'),
      end: new Date('2026-06-01T15:00:00Z'),
      organizer: { email: 'owner@example.com', name: 'Owner' },
      attendees: [{ email: 'guest@example.com', name: 'Guest' }],
      sequence: 0,
      now: FIXED_NOW,
    });

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('PRODID:-//Slotty//Slotty Booking//EN');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('formats DTSTART/DTEND in UTC compact form', () => {
    const ics = generateIcs({
      uid: 'u-1',
      summary: 'Test',
      start: new Date('2026-06-01T14:00:00Z'),
      end: new Date('2026-06-01T15:30:00Z'),
      organizer: { email: 'owner@example.com' },
      attendees: [],
      sequence: 0,
      now: FIXED_NOW,
    });

    expect(ics).toMatch(/DTSTART:20260601T140000Z/);
    expect(ics).toMatch(/DTEND:20260601T153000Z/);
    expect(ics).toMatch(/DTSTAMP:20260507T100000Z/);
  });

  it('emits ATTENDEE rows with mailto:', () => {
    const ics = generateIcs({
      uid: 'u-1',
      summary: 'Test',
      start: new Date('2026-06-01T14:00:00Z'),
      end: new Date('2026-06-01T15:00:00Z'),
      organizer: { email: 'owner@example.com' },
      attendees: [
        { email: 'guest@example.com', name: 'Guest', rsvp: true },
        { email: 'second@example.com' },
      ],
      sequence: 0,
      now: FIXED_NOW,
    });

    const unfolded = unfold(ics);
    expect(unfolded).toContain('mailto:guest@example.com');
    expect(unfolded).toContain('mailto:second@example.com');
    expect(unfolded).toContain('CN=Guest');
    expect(unfolded).toContain('PARTSTAT=NEEDS-ACTION');
  });

  it('escapes commas, semicolons, backslashes, and newlines in TEXT', () => {
    const ics = generateIcs({
      uid: 'u-1',
      summary: 'Hello, world; with line\nbreak and \\ slash',
      description: 'detail, ; \\ \nnext',
      start: new Date('2026-06-01T14:00:00Z'),
      end: new Date('2026-06-01T15:00:00Z'),
      organizer: { email: 'owner@example.com' },
      attendees: [],
      sequence: 0,
      now: FIXED_NOW,
    });

    expect(ics).toContain('SUMMARY:Hello\\, world\\; with line\\nbreak and \\\\ slash');
    expect(ics).toContain('DESCRIPTION:detail\\, \\; \\\\ \\nnext');
  });

  it('folds long lines at 75 octets with continuation prefix', () => {
    const longDesc = 'x'.repeat(200);
    const ics = generateIcs({
      uid: 'u-1',
      summary: 'Short',
      description: longDesc,
      start: new Date('2026-06-01T14:00:00Z'),
      end: new Date('2026-06-01T15:00:00Z'),
      organizer: { email: 'owner@example.com' },
      attendees: [],
      sequence: 0,
      now: FIXED_NOW,
    });

    // The DESCRIPTION line should be split across multiple lines, each
    // continuation starting with a single space.
    const lines = ics.split('\r\n');
    const descLines = lines.filter((l) => l.startsWith('DESCRIPTION:') || l.startsWith(' x'));
    expect(descLines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) {
      // Pure octet count limit is 75; continuation prefix included.
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    }
  });

  it('honors SEQUENCE and STATUS overrides', () => {
    const ics = generateIcs({
      uid: 'u-1',
      summary: 'Test',
      start: new Date('2026-06-01T14:00:00Z'),
      end: new Date('2026-06-01T15:00:00Z'),
      organizer: { email: 'owner@example.com' },
      attendees: [],
      sequence: 3,
      status: 'CANCELLED',
      method: 'CANCEL',
      now: FIXED_NOW,
    });

    expect(ics).toContain('SEQUENCE:3');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('METHOD:CANCEL');
  });
});
