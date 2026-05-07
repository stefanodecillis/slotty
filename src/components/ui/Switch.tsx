'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils/cn';

export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, 'children'> {
  /**
   * If provided, the switch renders inside a labeled row: label/description
   * on the left, switch on the right. The label is `htmlFor`-bound.
   */
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Class for the outer wrapper when `label` is set. */
  containerClassName?: string;
}

/**
 * M3 switch — 52×32 track, 16/24 thumb (off/on), filled-on accent.
 * Backed by Radix's Switch primitive for full a11y semantics.
 */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, label, description, containerClassName, id, disabled, ...props }, ref) => {
  const generatedId = React.useId();
  const switchId = id ?? generatedId;
  const descriptionId = description ? `${switchId}-description` : undefined;

  const root = (
    <SwitchPrimitive.Root
      id={switchId}
      ref={ref}
      disabled={disabled}
      aria-describedby={descriptionId}
      className={cn(
        'group relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full',
        'border-2 border-outline bg-surface-container-highest',
        'transition-colors duration-200 ease-emphasized',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'disabled:pointer-events-none disabled:opacity-38',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block rounded-full bg-outline shadow-sm',
          'transition-all duration-200 ease-emphasized',
          // Off: 16px thumb, left margin.
          'h-4 w-4 translate-x-1',
          // On: 24px thumb, shifted right to track end.
          'data-[state=checked]:h-6 data-[state=checked]:w-6 data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-on-primary',
          // Hover off: thumb grows slightly.
          'group-hover:h-5 group-hover:w-5 group-hover:translate-x-[2px]',
          // Hover on: keep thumb pinned right.
          'group-hover:data-[state=checked]:translate-x-[20px]',
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label && !description) {
    return root;
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4',
        disabled && 'opacity-38',
        containerClassName,
      )}
    >
      <div className="flex flex-col gap-0.5">
        {label && (
          <label htmlFor={switchId} className="cursor-pointer text-label-l text-on-surface">
            {label}
          </label>
        )}
        {description && (
          <p id={descriptionId} className="text-body-s text-on-surface-variant">
            {description}
          </p>
        )}
      </div>
      {root}
    </div>
  );
});

Switch.displayName = 'Switch';
