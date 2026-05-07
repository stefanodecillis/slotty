import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import { StateLayer } from './StateLayer';
import type { StateLayerProps } from './StateLayer';

const iconButtonVariants = cva(
  [
    'relative inline-flex h-10 w-10 items-center justify-center overflow-hidden',
    'rounded-full text-[24px]',
    'select-none outline-none',
    'transition-colors duration-200 ease-standard',
    'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-38',
    'group',
  ],
  {
    variants: {
      variant: {
        standard: 'bg-transparent text-on-surface-variant',
        filled: 'bg-primary text-on-primary',
        'filled-tonal': 'bg-secondary-container text-on-secondary-container',
        outlined: 'border border-outline bg-transparent text-on-surface-variant',
      },
    },
    defaultVariants: {
      variant: 'standard',
    },
  },
);

type StateLayerColor = StateLayerProps['color'];

function resolveStateLayerColor(variant: string | null | undefined): StateLayerColor {
  if (variant === 'filled') return 'on-primary';
  if (variant === 'filled-tonal') return 'on-secondary-container';
  return 'on-surface-variant';
}

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  label: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'standard', disabled, label, children, ...props }, ref) => {
    const stateLayerColor = resolveStateLayerColor(variant);

    return (
      <button
        ref={ref}
        disabled={disabled}
        aria-label={label}
        className={cn(iconButtonVariants({ variant }), className)}
        {...props}
      >
        <StateLayer color={stateLayerColor} disabled={disabled} />
        {children}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';
