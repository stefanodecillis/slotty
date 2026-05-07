'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * M3 outlined textarea — bare primitive, no floating label.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'flex w-full rounded-shape-xs border border-outline bg-transparent px-4 py-3',
          'text-body-l text-on-surface',
          'placeholder:text-on-surface-variant/60',
          'transition-colors duration-200 ease-standard',
          'outline-none focus:border-2 focus:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-38',
          'aria-[invalid=true]:border-error aria-[invalid=true]:focus:border-error',
          'resize-y',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
