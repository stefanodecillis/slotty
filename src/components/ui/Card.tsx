import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const cardVariants = cva(
  ['relative flex flex-col overflow-hidden rounded-shape-md transition-shadow duration-200 ease-standard'],
  {
    variants: {
      variant: {
        filled: 'bg-surface-container-highest',
        outlined: 'border border-outline-variant bg-surface',
        elevated: 'bg-surface-container-low shadow-sm hover:shadow-md',
      },
    },
    defaultVariants: {
      variant: 'filled',
    },
  },
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

function CardRoot({ className, variant, children, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ variant }), className)} {...props}>
      {children}
    </div>
  );
}

CardRoot.displayName = 'Card';

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 px-4 pb-2 pt-4', className)}
      {...props}
    />
  ),
);

CardHeader.displayName = 'Card.Header';

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-4 pb-4 text-body-m text-on-surface', className)} {...props} />
  ),
);

CardContent.displayName = 'Card.Content';

const CardActions = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-end gap-2 px-4 pb-4 pt-2', className)}
      {...props}
    />
  ),
);

CardActions.displayName = 'Card.Actions';

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Content: CardContent,
  Actions: CardActions,
});
