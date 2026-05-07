import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const stateLayerVariants = cva(
  [
    'pointer-events-none absolute inset-0 rounded-[inherit]',
    'transition-colors duration-200 ease-standard',
    'opacity-0',
    'group-hover:opacity-[0.08]',
    'group-focus-visible:opacity-[0.12]',
    'group-active:opacity-[0.12]',
  ],
  {
    variants: {
      color: {
        'on-primary': 'bg-on-primary',
        'on-secondary-container': 'bg-on-secondary-container',
        'on-surface': 'bg-on-surface',
        'on-surface-variant': 'bg-on-surface-variant',
        'on-tertiary': 'bg-on-tertiary',
        'on-tertiary-container': 'bg-on-tertiary-container',
        'on-error': 'bg-on-error',
        primary: 'bg-primary',
      },
    },
    defaultVariants: {
      color: 'on-surface',
    },
  },
);

export interface StateLayerProps extends VariantProps<typeof stateLayerVariants> {
  disabled?: boolean;
  className?: string;
}

export const StateLayer = forwardRef<HTMLSpanElement, StateLayerProps>(
  ({ color, disabled, className }, ref) => {
    if (disabled) return null;

    return (
      <span
        ref={ref}
        aria-hidden="true"
        className={cn(stateLayerVariants({ color }), className)}
      />
    );
  },
);

StateLayer.displayName = 'StateLayer';
