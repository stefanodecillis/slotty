/**
 * Pre-filling a participant's answer without saving it.
 *
 * The Google import hands the free time it found back to the participant's
 * own browser in the URL fragment (never sent to a server, never logged),
 * and the poll page paints it into the grid as unsaved changes. Nothing is
 * stored until the participant reviews it and presses Save.
 *
 * Pure and browser-safe: used by the Google callback and the poll page.
 */

export interface FreeSpan {
  /** Epoch ms, inclusive. */
  start: number;
  /** Epoch ms, exclusive. */
  end: number;
}

/** Fragment key for free time found by the Google import. */
export const GOOGLE_FREE_PARAM = 'google-free';

/** Merge candidate slots into the fewest spans that cover exactly them. */
export function spansFromSlots(slots: readonly { startUtc: string; endUtc: string }[]): FreeSpan[] {
  const sorted = slots
    .map((s) => ({ start: Date.parse(s.startUtc), end: Date.parse(s.endUtc) }))
    .sort((a, b) => a.start - b.start);
  const out: FreeSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** `start-end,start-end` in epoch minutes: short, URL-safe, no encoding needed. */
export function encodeSpans(spans: readonly FreeSpan[]): string {
  return spans.map((s) => `${Math.floor(s.start / 60_000)}-${Math.ceil(s.end / 60_000)}`).join(',');
}

export function decodeSpans(value: string | null | undefined): FreeSpan[] {
  if (!value) return [];
  const out: FreeSpan[] = [];
  for (const part of value.split(',').slice(0, 5000)) {
    const m = /^(\d{1,10})-(\d{1,10})$/.exec(part);
    if (!m) continue;
    const start = Number(m[1]) * 60_000;
    const end = Number(m[2]) * 60_000;
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** The candidates that fit entirely inside one of the spans. */
export function slotsWithinSpans<T extends { startUtc: string; endUtc: string }>(
  slots: readonly T[],
  spans: readonly FreeSpan[],
): T[] {
  return slots.filter((slot) => {
    const s = Date.parse(slot.startUtc);
    const e = Date.parse(slot.endUtc);
    return spans.some((span) => span.start <= s && span.end >= e);
  });
}
