'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (tz: string) => void;
}

const STORAGE_KEY = 'slotty.bookerTz';

/**
 * Time-zone picker for the booking flow. Renders as a quiet text-button that
 * opens a dropdown with search. Persists choice in localStorage.
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

  // Persist on every change.
  useEffect(() => {
    if (!value) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* storage quota / disabled */
    }
  }, [value]);

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
        className="flex items-center gap-1 rounded-shape-xs px-2 py-1 text-body-s text-on-surface-variant transition-colors hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="material-symbols-outlined text-[14px]" aria-hidden>public</span>
        <span className="max-w-[120px] truncate">{displayValue}</span>
        <span className="material-symbols-outlined text-[14px]" aria-hidden>
          {open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-shape-md border border-outline-variant bg-surface-container shadow-lg"
          role="dialog"
          aria-label="Select timezone"
        >
          <div className="border-b border-outline-variant/40 px-3 py-2">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search timezones..."
              className="w-full bg-transparent text-body-s text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none"
            />
          </div>
          <ul
            role="listbox"
            aria-label="Timezones"
            className="max-h-48 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-body-s text-on-surface-variant">No results</li>
            )}
            {filtered.map((z) => (
              <li key={z} role="option" aria-selected={z === value}>
                <button
                  type="button"
                  onClick={() => { onChange(z); setOpen(false); setQuery(''); }}
                  className={[
                    'w-full px-3 py-1.5 text-left text-body-s transition-colors hover:bg-surface-container-high',
                    z === value ? 'font-medium text-primary' : 'text-on-surface',
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
