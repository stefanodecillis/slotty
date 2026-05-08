'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Globe } from 'lucide-react';

interface Props {
  value: string;
  onChange: (tz: string) => void;
}

const STORAGE_KEY = 'slotty.bookerTz';

/**
 * Time-zone picker for the booking flow. Renders as a quiet text-button that
 * opens a dropdown with search. Persists the booker's choice in localStorage
 * — but only after the user explicitly picks a zone, so the SSR placeholder
 * value never pollutes storage on first paint.
 */
export function TzSelector({ value, onChange }: Props) {
  const [zones, setZones] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supported =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? ['UTC'];
    setZones(supported);
  }, []);

  function pick(z: string) {
    try {
      window.localStorage.setItem(STORAGE_KEY, z);
    } catch {
      /* storage quota / disabled */
    }
    onChange(z);
    setOpen(false);
    setQuery('');
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Focus input when opening.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().replace(/_/g, ' ');
    if (!q) return zones.slice(0, 80);
    return zones
      .filter((z) => z.toLowerCase().replace(/_/g, ' ').includes(q))
      .slice(0, 60);
  }, [zones, query]);

  const displayValue = value.replace(/_/g, ' ');

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(''); }}
        className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="max-w-[120px] truncate">{displayValue}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-muted shadow-lg"
          role="dialog"
          aria-label="Select timezone"
        >
          <div className="border-b border-border/40 px-3 py-2">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search timezones..."
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </div>
          <ul
            role="listbox"
            aria-label="Timezones"
            className="max-h-48 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {filtered.map((z) => (
              <li key={z} role="option" aria-selected={z === value}>
                <button
                  type="button"
                  onClick={() => pick(z)}
                  className={[
                    'w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-card',
                    z === value ? 'font-medium text-primary' : 'text-foreground',
                  ].join(' ')}
                >
                  {z.replace(/_/g, ' ')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Resolve the initial booker tz.
 *
 * Order:
 *   1. Browser-detected tz (from `Intl.DateTimeFormat`) — the booker's actual
 *      local tz is almost always what they want and matches Calendly UX.
 *   2. localStorage value, IF the booker explicitly picked a different zone
 *      from their detected one in a previous visit. We only honour the stored
 *      value when it differs from the detected zone; otherwise stale
 *      'UTC' pollution from earlier versions would override the real tz.
 *   3. 'UTC' as the last resort (and the SSR placeholder).
 */
export function getInitialBookerTz(): string {
  if (typeof window === 'undefined') return 'UTC';

  let detected = '';
  try {
    detected = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* no Intl */
  }

  let stored = '';
  try {
    stored = window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    /* storage disabled */
  }

  // A stored value only counts as a deliberate booker choice when it diverges
  // from what the browser detects. This wipes legacy 'UTC' rows that earlier
  // versions persisted on first paint.
  if (stored && detected && stored !== detected && stored !== 'UTC') {
    return stored;
  }

  if (detected) {
    // Self-heal: clear any stale stored value that matches detected (to avoid
    // re-triggering this branch indefinitely) or that is the legacy 'UTC'.
    if (stored && (stored === detected || stored === 'UTC')) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    return detected;
  }

  return stored || 'UTC';
}
