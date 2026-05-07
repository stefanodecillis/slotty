'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * M3 outlined input — bare primitive, no floating label.
 *
 * Use `<Label htmlFor=…>` + `<Input id=…>` for the canonical shadcn pattern.
 * For the floating-label composite, use `<TextField>`.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-14 w-full rounded-shape-xs border border-outline bg-transparent px-4',
          'text-body-l text-on-surface',
          'placeholder:text-on-surface-variant/60',
          'transition-colors duration-200 ease-standard',
          'outline-none focus:border-2 focus:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-38',
          'aria-[invalid=true]:border-error aria-[invalid=true]:focus:border-error',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
