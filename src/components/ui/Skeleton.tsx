import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Loading-state placeholder. Subtle pulse on the surface-container-highest
 * tone so it reads as inert content awaiting load.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('animate-pulse rounded-shape-sm bg-surface-container-highest', className)}
      {...props}
    />
  ),
);
Skeleton.displayName = 'Skeleton';
