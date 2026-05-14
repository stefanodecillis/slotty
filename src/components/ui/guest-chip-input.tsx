'use client';

/**
 * GuestChipInput — email chip input used on both the public booking form and
 * admin forms (event-type "hidden guests", per-invite override).
 *
 * Behavior:
 *  - Comma-separated entry, Enter to confirm, Backspace at an empty draft
 *    removes the last chip and pulls it back into the draft for editing.
 *  - Inline email validation via a tolerant regex (server-side is the source
 *    of truth; this is purely UX).
 *  - At capacity (`value.length >= max`), the input is disabled and the
 *    placeholder communicates the limit.
 */
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';

export function emailLooksValid(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

interface GuestChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  placeholder?: string;
  id?: string;
}

export function GuestChipInput({ value, onChange, max, placeholder, id }: GuestChipInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const atCapacity = value.length >= max;

  function commitDraft(raw: string): boolean {
    const candidate = raw.trim().replace(/,+$/, '').trim();
    if (!candidate) return true;
    if (!emailLooksValid(candidate)) {
      toast.error(`"${candidate}" is not a valid email address.`);
      return false;
    }
    if (value.includes(candidate)) {
      setDraft('');
      return true;
    }
    if (value.length >= max) {
      toast.error(`You can add at most ${max} guest${max === 1 ? '' : 's'}.`);
      return false;
    }
    onChange([...value, candidate]);
    setDraft('');
    return true;
  }

  function handleChange(next: string) {
    if (next.includes(',')) {
      const parts = next.split(',');
      const last = parts.pop() ?? '';
      let allOk = true;
      for (const part of parts) {
        if (!commitDraft(part)) {
          allOk = false;
          setDraft(part.trim());
          return;
        }
      }
      if (allOk) setDraft(last);
      return;
    }
    setDraft(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (draft.trim()) {
        e.preventDefault();
        commitDraft(draft);
      }
      return;
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      const next = value.slice(0, -1);
      onChange(next);
      setDraft(value[value.length - 1] ?? '');
    }
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  return (
    <div
      className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((g, i) => (
        <span
          key={g}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 py-0.5 pl-2 pr-1 text-xs font-medium text-primary"
        >
          {g}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeAt(i);
            }}
            className="flex h-4 w-4 items-center justify-center rounded-sm text-primary/70 transition-colors hover:bg-primary/20 hover:text-primary focus:outline-none"
            aria-label={`Remove ${g}`}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (draft.trim()) commitDraft(draft);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text.includes(',') || text.includes('\n')) {
            e.preventDefault();
            const parts = text.split(/[,\n]/);
            for (const part of parts) {
              if (!commitDraft(part)) return;
            }
          }
        }}
        disabled={atCapacity}
        placeholder={
          atCapacity
            ? `Limit reached (${max})`
            : value.length === 0
              ? (placeholder ?? 'alice@example.com, bob@example.com')
              : ''
        }
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
