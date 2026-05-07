import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Material You (M3) icon button — 40×40 round, four variants.
 *
 * Caller passes the icon as `children`. A string child is auto-rendered as a
 * Material Symbol; any other ReactNode (e.g. an `<svg>`) is rendered as-is.
 */
const iconButtonVariants = cva(
  [
    'relative inline-flex h-10 w-10 items-center justify-center',
    'rounded-full text-[24px]',
    'select-none outline-none',
    'transition-colors duration-200 ease-standard',
    'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-38',
  ],
  {
    variants: {
      variant: {
        standard: [
          'bg-transparent text-on-surface-variant',
          'hover:bg-on-surface-variant/[0.08]',
          'focus-visible:bg-on-surface-variant/[0.12]',
          'active:bg-on-surface-variant/[0.12]',
        ].join(' '),
        filled: [
          'bg-primary text-on-primary',
          'hover:bg-primary/90',
          'focus-visible:bg-primary/[0.92]',
          'active:bg-primary/[0.88]',
        ].join(' '),
        tonal: [
          'bg-secondary-container text-on-secondary-container',
          'hover:bg-secondary-container/90',
          'focus-visible:bg-secondary-container/[0.92]',
          'active:bg-secondary-container/[0.88]',
        ].join(' '),
        // Back-compat alias for the original `filled-tonal`.
        'filled-tonal': [
          'bg-secondary-container text-on-secondary-container',
          'hover:bg-secondary-container/90',
          'focus-visible:bg-secondary-container/[0.92]',
          'active:bg-secondary-container/[0.88]',
        ].join(' '),
        outlined: [
          'border border-outline bg-transparent text-on-surface-variant',
          'hover:bg-on-surface-variant/[0.08]',
          'focus-visible:bg-on-surface-variant/[0.12]',
          'active:bg-on-surface-variant/[0.12]',
        ].join(' '),
      },
    },
    defaultVariants: {
      variant: 'standard',
    },
  },
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible label — required since icon-only buttons have no visible text. */
  label: string;
  /**
   * Icon content. A string is rendered as a Material Symbol icon; any other
   * ReactNode is rendered as-is.
   */
  children?: React.ReactNode;
  asChild?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, label, asChild = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    const renderedChild =
      typeof children === 'string' ? (
        <span className="material-symbols-outlined">{children}</span>
      ) : (
        children
      );

    if (asChild) {
      return (
        <Comp
          ref={ref as React.Ref<HTMLButtonElement>}
          aria-label={label}
          aria-disabled={disabled || undefined}
          className={cn(iconButtonVariants({ variant }), className)}
          {...props}
        >
          {renderedChild}
        </Comp>
      );
    }

    return (
      <button
        ref={ref}
        aria-label={label}
        disabled={disabled}
        className={cn(iconButtonVariants({ variant }), className)}
        {...props}
      >
        {renderedChild}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';

export { iconButtonVariants };
