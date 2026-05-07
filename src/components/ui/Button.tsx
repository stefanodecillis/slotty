import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Material You (M3) button.
 *
 * Variants:
 *  - filled    — primary call-to-action.
 *  - tonal     — secondary container, less emphasis than filled.
 *  - outlined  — high-emphasis-but-not-primary action.
 *  - text      — low-emphasis inline action.
 *  - elevated  — surface-container-low with subtle shadow.
 *
 * Sizes:
 *  - sm (32px), md (40px, default), lg (56px). `default` is kept as an alias
 *    for `md` so existing `size="default"` callers keep working.
 *
 * State-layer behaviour (M3 spec — 8% hover / 12% focus / 12% pressed) is
 * encoded directly via Tailwind utilities (`hover:bg-…/[0.08]` etc.) rather
 * than the older `<StateLayer />` overlay. Each variant uses the appropriate
 * "on-*" foreground color so the overlay reads correctly against the base.
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2',
    'rounded-full font-medium text-label-l',
    'select-none outline-none',
    'transition-[background-color,box-shadow,color] duration-200 ease-standard',
    'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-38',
  ],
  {
    variants: {
      variant: {
        filled: [
          'bg-primary text-on-primary shadow-sm hover:shadow-md',
          'hover:bg-primary/90',
          'focus-visible:bg-primary/[0.92]',
          'active:bg-primary/[0.88]',
        ].join(' '),
        tonal: [
          'bg-secondary-container text-on-secondary-container shadow-sm hover:shadow-md',
          'hover:bg-secondary-container/90',
          'focus-visible:bg-secondary-container/[0.92]',
          'active:bg-secondary-container/[0.88]',
        ].join(' '),
        outlined: [
          'border border-outline bg-transparent text-primary',
          'hover:bg-primary/[0.08]',
          'focus-visible:bg-primary/[0.12]',
          'active:bg-primary/[0.12]',
        ].join(' '),
        text: [
          'bg-transparent text-primary',
          'hover:bg-primary/[0.08]',
          'focus-visible:bg-primary/[0.12]',
          'active:bg-primary/[0.12]',
        ].join(' '),
        elevated: [
          'bg-surface-container-low text-primary shadow-sm hover:shadow-md',
          'hover:bg-primary/[0.08]',
          'focus-visible:bg-primary/[0.12]',
          'active:bg-primary/[0.12]',
        ].join(' '),
      },
      size: {
        sm: 'h-8 px-4 text-label-m',
        md: 'h-10 px-6',
        lg: 'h-14 px-8',
        default: 'h-10 px-6',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'filled',
      size: 'md',
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  /**
   * When true, render via Radix's `<Slot>` so the immediate child element
   * inherits the button styles. Useful for `<Link>`/`<a>` wrapping.
   *
   * Note: when `asChild` is true, `loading` is rendered without disabling the
   * underlying element (since it may not be a button).
   */
  asChild?: boolean;
}

const Spinner = () => (
  <svg
    className="h-4 w-4 animate-spin"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
    />
  </svg>
);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      leadingIcon,
      trailingIcon,
      loading = false,
      disabled,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;

    const content = (
      <>
        {loading ? (
          <Spinner />
        ) : (
          leadingIcon && <span className="flex shrink-0 items-center text-[18px]">{leadingIcon}</span>
        )}
        {children}
        {!loading && trailingIcon && (
          <span className="flex shrink-0 items-center text-[18px]">{trailingIcon}</span>
        )}
      </>
    );

    if (asChild) {
      return (
        <Comp
          ref={ref as React.Ref<HTMLButtonElement>}
          className={cn(buttonVariants({ variant, size, fullWidth }), className)}
          aria-disabled={isDisabled || undefined}
          {...props}
        >
          {content}
        </Comp>
      );
    }

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        {...props}
      >
        {content}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { buttonVariants };
