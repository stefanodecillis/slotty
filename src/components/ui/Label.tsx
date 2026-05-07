'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils/cn';

/**
 * M3-styled label, backed by Radix's Label primitive (proper `htmlFor`
 * forwarding + accessible click-to-focus on the associated form control).
 */
export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-label-l text-on-surface',
      'peer-disabled:cursor-not-allowed peer-disabled:opacity-38',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';
