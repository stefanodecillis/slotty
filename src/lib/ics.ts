/**
 * Generate RFC 5545 (iCalendar) `VEVENT` payloads for booking confirmations.
 *
 * We emit METHOD:REQUEST so mail clients treat it as an invite. Times are
 * always in UTC (suffix Z) so we don't need a `VTIMEZONE` block. Long lines
 * are folded at 75 octets per RFC 5545 section 3.1.
 */

import { DateTime } from 'luxon';

export interface IcsAttendee {
  email: string;
  name?: string;
  /** Defaults to REQ-PARTICIPANT. */
  role?: 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT' | 'CHAIR';
  /** Defaults to NEEDS-ACTION. */
  partstat?: 'ACCEPTED' | 'DECLINED' | 'NEEDS-ACTION' | 'TENTATIVE';
  rsvp?: boolean;
}

export interface IcsArgs {
  /**
   * Globally unique event identifier. Use a DB-backed value so the same UID
   * persists across updates (RFC 5545 requires UID stability for SEQUENCE-
   * driven updates to be interpreted correctly by clients).
   */
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  organizer: { email: string; name?: string };
  attendees: IcsAttendee[];
  /**
   * Increment on every modification. Initial CREATE = 0. Must monotonically
   * increase. RFC 5545 section 3.8.7.4.
   */
  sequence: number;
  /** Override "now" for tests. */
  now?: Date;
  /** Free-form METHOD; defaults to REQUEST. */
  method?: 'REQUEST' | 'CANCEL' | 'PUBLISH';
  /** Defaults to CONFIRMED. */
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
}

/**
 * Format a Date as `YYYYMMDDTHHMMSSZ` per RFC 5545 form #2 (UTC).
 */
function formatUtc(date: Date): string {
  return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat("yyyyLLdd'T'HHmmss'Z'");
}

/**
 * Escape a TEXT value per RFC 5545 section 3.3.11:
 * `\\` `\,` `\;` and CRLF -> `\n`.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Fold a single content line at 75 octets, with a single space prefix on each
 * continuation line. We measure octets in UTF-8 because the spec is byte-
 * oriented; for ASCII content this is identical to character count.
 */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const bytes = enc.encode(line);
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let offset = 0;
  let isFirst = true;
  while (offset < bytes.length) {
    const limit = isFirst ? 75 : 74; // continuation rows reserve 1 byte for the leading space
    const sliceEnd = Math.min(offset + limit, bytes.length);
    // Walk back if we'd land mid-codepoint.
    let safeEnd = sliceEnd;
    while (safeEnd > offset && (bytes[safeEnd] !== undefined && (bytes[safeEnd]! & 0xc0) === 0x80)) {
      safeEnd -= 1;
    }
    const chunk = dec.decode(bytes.slice(offset, safeEnd));
    out.push(isFirst ? chunk : ` ${chunk}`);
    offset = safeEnd;
    isFirst = false;
  }
  return out.join('\r\n');
}

function field(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function attendeeLine(a: IcsAttendee): string {
  const parts: string[] = [];
  parts.push(`ROLE=${a.role ?? 'REQ-PARTICIPANT'}`);
  parts.push(`PARTSTAT=${a.partstat ?? 'NEEDS-ACTION'}`);
  parts.push(`RSVP=${a.rsvp === false ? 'FALSE' : 'TRUE'}`);
  if (a.name) parts.push(`CN=${escapeText(a.name)}`);
  // ATTENDEE has params before the colon; we still need to fold the whole line.
  return foldLine(`ATTENDEE;${parts.join(';')}:mailto:${a.email}`);
}

export function generateIcs(args: IcsArgs): string {
  const now = args.now ?? new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Slotty//Slotty Booking//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${args.method ?? 'REQUEST'}`,
    'BEGIN:VEVENT',
    field('UID', args.uid),
    field('DTSTAMP', formatUtc(now)),
    field('CREATED', formatUtc(now)),
    field('LAST-MODIFIED', formatUtc(now)),
    field('SEQUENCE', String(args.sequence)),
    field('STATUS', args.status ?? 'CONFIRMED'),
    field('DTSTART', formatUtc(args.start)),
    field('DTEND', formatUtc(args.end)),
    field('SUMMARY', escapeText(args.summary)),
  ];

  if (args.description) lines.push(field('DESCRIPTION', escapeText(args.description)));
  if (args.location) lines.push(field('LOCATION', escapeText(args.location)));

  const orgName = args.organizer.name ? `;CN=${escapeText(args.organizer.name)}` : '';
  lines.push(foldLine(`ORGANIZER${orgName}:mailto:${args.organizer.email}`));

  for (const a of args.attendees) lines.push(attendeeLine(a));

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}
