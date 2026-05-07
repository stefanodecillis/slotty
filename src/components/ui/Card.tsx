import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Material You (M3) Card.
 *
 * Three variants — `filled` (surface-container-highest), `outlined`, `elevated`.
 * Composed from `<CardRoot>` plus `<CardHeader>`, `<CardTitle>`,
 * `<CardDescription>`, `<CardContent>`, `<CardActions>`.
 *
 * The legacy `<Card.Header>` / `<Card.Content>` / `<Card.Actions>` namespace
 * is preserved via `Object.assign` for backwards compatibility, but new code
 * should prefer the named exports for cleaner RSC bundling.
 */
const cardVariants = cva(
  [
    'relative flex flex-col overflow-hidden rounded-shape-md',
    'transition-shadow duration-200 ease-standard',
  ],
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
    VariantProps<typeof cardVariants> {
  asChild?: boolean;
}

const CardRoot = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(cardVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
CardRoot.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 px-4 pb-2 pt-4', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-headline-s text-on-surface', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-body-m text-on-surface-variant', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-4 pb-4 text-body-m text-on-surface', className)}
      {...props}
    />
  ),
);
CardContent.displayName = 'CardContent';

const CardActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center justify-end gap-2 px-4 pb-4 pt-2', className)}
      {...props}
    />
  ),
);
CardActions.displayName = 'CardActions';

/**
 * Backwards-compatible namespace export. New code should import the
 * individual subcomponents directly.
 */
const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
  Actions: CardActions,
});

export { Card, CardRoot, CardHeader, CardTitle, CardDescription, CardContent, CardActions, cardVariants };
