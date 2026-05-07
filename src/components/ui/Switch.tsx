'use client';

import React, { forwardRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils/cn';

export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  label?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, label, disabled, ...props }, ref) => {
    return (
      <SwitchPrimitive.Root
        ref={ref}
        disabled={disabled}
        className={cn(
          'group relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full',
          'border-2 border-outline bg-surface-container-highest',
          'transition-colors duration-200 ease-emphasized',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
          'disabled:pointer-events-none disabled:opacity-38',
          className,
        )}
        aria-label={label}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'block rounded-full bg-outline shadow-sm',
            'transition-all duration-200 ease-emphasized',
            // Off state: 16px thumb, left margin
            'h-4 w-4 translate-x-1',
            // On state: 24px thumb, shifted right so it sits at track end
            'data-[state=checked]:h-6 data-[state=checked]:w-6 data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-on-primary',
            // Hover in off state: thumb grows slightly
            'group-hover:h-5 group-hover:w-5 group-hover:translate-x-[2px]',
            // Hover in on state: keep thumb pinned right (override grow offset)
            'group-hover:data-[state=checked]:translate-x-[20px]',
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);

Switch.displayName = 'Switch';
