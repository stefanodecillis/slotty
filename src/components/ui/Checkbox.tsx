'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cn } from '@/lib/utils/cn';

/**
 * M3 checkbox — 18×18 rounded square with primary-colored fill on check.
 */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center',
      'rounded-shape-xs border-2 border-on-surface-variant bg-transparent',
      'transition-colors duration-200 ease-standard',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
      'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
      'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
      'disabled:pointer-events-none disabled:opacity-38',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-on-primary">
      <svg
        className="h-3 w-3"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';
