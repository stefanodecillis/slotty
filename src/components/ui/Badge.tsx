import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  [
    'inline-flex items-center justify-center gap-1',
    'rounded-shape-xs px-2 py-0.5',
    'text-label-s font-medium',
    'transition-colors duration-200 ease-standard',
  ],
  {
    variants: {
      variant: {
        default: 'bg-secondary-container text-on-secondary-container',
        outline: 'border border-outline bg-transparent text-on-surface-variant',
        destructive: 'bg-error-container text-on-error-container',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
