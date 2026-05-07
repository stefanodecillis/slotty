/**
 * In-memory LRU-ish cache for slot computation results.
 *
 * Keying: `eventTypeId|fromMs|toMs|tz|busyMaxUpdatedAt`. The last component
 * folds in BusyEvent.updatedAt so the cache invalidates automatically when
 * a sync changes any busy block touching the window — but the explicit
 * `invalidate()` is also wired in for booking creation and incremental sync
 * completion to avoid the read-after-write race.
 *
 * TTL is 30s. The cache is global and bounded (FIFO eviction at MAX entries).
 */

import type { SlotResult } from './compute-types';

interface Entry {
  value: SlotResult;
  expiresAt: number;
}

const TTL_MS = 30_000;
const MAX_ENTRIES = 256;

const store = new Map<string, Entry>();

export function makeKey(parts: {
  eventTypeId: string;
  fromMs: number;
  toMs: number;
  tz: string;
  busyMaxUpdatedAtMs: number;
}): string {
  return [
    parts.eventTypeId,
    parts.fromMs,
    parts.toMs,
    parts.tz,
    parts.busyMaxUpdatedAtMs,
  ].join('|');
}

export function getSlots(key: string): SlotResult | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  // Refresh recency for FIFO eviction.
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function setSlots(key: string, value: SlotResult, ttlMs: number = TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Drop cache entries.
 *
 * - With no argument: clears the entire cache.
 * - With `eventTypeId`: drops every entry whose key starts with that id —
 *   used by Phase 7 booking creation, and Phase 3 incremental sync completion
 *   (when a sync completes, just call `invalidate()` to drop everything since
 *   the busy table is now stale across all event types).
 */
export function invalidate(eventTypeId?: string): void {
  if (eventTypeId === undefined) {
    store.clear();
    return;
  }
  const prefix = `${eventTypeId}|`;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Visible for tests. */
export function _cacheSize(): number {
  return store.size;
}
