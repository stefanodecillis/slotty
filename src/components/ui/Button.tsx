import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import { StateLayer } from './StateLayer';
import type { StateLayerProps } from './StateLayer';

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 overflow-hidden',
    'rounded-full font-medium text-label-l',
    'select-none outline-none',
    'transition-shadow duration-200 ease-standard',
    'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-38',
    'group',
  ],
  {
    variants: {
      variant: {
        filled: 'bg-primary text-on-primary shadow-sm hover:shadow-md',
        tonal: 'bg-secondary-container text-on-secondary-container shadow-sm hover:shadow-md',
        outlined:
          'border border-outline bg-transparent text-primary hover:bg-primary/[0.08]',
        text: 'bg-transparent text-primary',
        elevated:
          'bg-surface-container-low text-primary shadow-sm hover:shadow-md',
        'icon-button': 'bg-primary text-on-primary shadow-sm hover:shadow-md',
      },
      size: {
        default: 'h-10 px-6',
        fab: 'h-14 px-5 rounded-shape-xl text-label-l',
        icon: 'h-10 w-10 p-0',
        'small-icon': 'h-8 w-8 p-0',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'filled',
      size: 'default',
      fullWidth: false,
    },
  },
);

type StateLayerColor = StateLayerProps['color'];

function resolveStateLayerColor(variant: string | null | undefined): StateLayerColor {
  if (variant === 'filled' || variant === 'icon-button') return 'on-primary';
  if (variant === 'tonal') return 'on-secondary-container';
  return 'on-surface';
}

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'filled',
      size = 'default',
      fullWidth = false,
      leadingIcon,
      trailingIcon,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const stateLayerColor = resolveStateLayerColor(variant);
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        {...props}
      >
        <StateLayer color={stateLayerColor} disabled={isDisabled} />
        {loading ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          leadingIcon && <span className="flex-shrink-0 text-[18px]">{leadingIcon}</span>
        )}
        {children}
        {!loading && trailingIcon && (
          <span className="flex-shrink-0 text-[18px]">{trailingIcon}</span>
        )}
      </button>
    );
  },
);

Button.displayName = 'Button';
