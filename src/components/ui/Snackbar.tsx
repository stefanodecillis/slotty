'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

type SnackbarVariant = 'default' | 'success' | 'warning' | 'error';

interface SnackbarItem {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
  variant?: SnackbarVariant;
}

interface SnackbarContextValue {
  show: (item: Omit<SnackbarItem, 'id'>) => void;
}

const SnackbarContext = React.createContext<SnackbarContextValue | null>(null);

export function useSnackbar(): SnackbarContextValue {
  const ctx = React.useContext(SnackbarContext);
  if (!ctx) {
    throw new Error('useSnackbar must be used inside <SnackbarProvider>');
  }
  return ctx;
}

type SwipeDirection = 'right' | 'left' | 'up' | 'down';

interface SnackbarProviderProps {
  children: React.ReactNode;
  swipeDirection?: SwipeDirection;
}

export function SnackbarProvider({
  children,
  swipeDirection = 'down',
}: SnackbarProviderProps) {
  const [items, setItems] = React.useState<SnackbarItem[]>([]);
  const counterRef = React.useRef(0);

  const show = React.useCallback((item: Omit<SnackbarItem, 'id'>) => {
    counterRef.current += 1;
    const id = `snackbar-${counterRef.current}`;
    setItems((prev) => [...prev, { ...item, id }]);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const value = React.useMemo<SnackbarContextValue>(() => ({ show }), [show]);

  return (
    <SnackbarContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection={swipeDirection}>
        {children}

        {items.map((item) => (
          <SnackbarToast
            key={item.id}
            item={item}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          />
        ))}

        <ToastPrimitive.Viewport
          className={cn(
            'fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2',
            'w-full max-w-[344px] px-4',
            'outline-none',
          )}
        />
      </ToastPrimitive.Provider>
    </SnackbarContext.Provider>
  );
}

const snackbarVariants = cva(
  [
    'group flex items-center justify-between gap-4',
    'rounded-shape-xs px-4 py-3',
    'shadow-lg',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    'data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4',
    'transition-all duration-300 ease-emphasized',
    'data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)]',
    'data-[swipe=cancel]:translate-y-0 data-[swipe=end]:animate-out',
  ],
  {
    variants: {
      variant: {
        default: 'bg-inverse-surface text-inverse-on-surface',
        success: 'bg-inverse-surface text-inverse-on-surface ring-1 ring-inset ring-tertiary',
        warning: 'bg-inverse-surface text-inverse-on-surface ring-1 ring-inset ring-secondary',
        error: 'bg-error text-on-error',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface SnackbarToastProps {
  item: SnackbarItem;
  onOpenChange: (open: boolean) => void;
}

function SnackbarToast({ item, onOpenChange }: SnackbarToastProps) {
  const variant = item.variant ?? 'default';
  return (
    <ToastPrimitive.Root
      open
      duration={item.duration ?? 4000}
      onOpenChange={onOpenChange}
      className={cn(snackbarVariants({ variant }))}
    >
      <ToastPrimitive.Description
        className={cn(
          'flex-1 text-body-m',
          variant === 'error' ? 'text-on-error' : 'text-inverse-on-surface',
        )}
      >
        {item.message}
      </ToastPrimitive.Description>

      {item.actionLabel && (
        <ToastPrimitive.Action
          altText={item.actionLabel}
          onClick={item.onAction}
          className={cn(
            'flex-shrink-0 rounded-shape-xs px-3 py-1',
            'text-label-l',
            'transition-colors duration-200 ease-standard',
            variant === 'error'
              ? 'text-on-error hover:bg-on-error/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-error'
              : 'text-inverse-primary hover:bg-on-surface/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-primary',
          )}
        >
          {item.actionLabel}
        </ToastPrimitive.Action>
      )}
    </ToastPrimitive.Root>
  );
}

/**
 * Standalone snackbar action — useful for callers building custom toasts via
 * the lower-level Radix primitives. Supports `asChild` for wrapping links.
 */
export interface SnackbarActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof snackbarVariants> {
  asChild?: boolean;
  altText: string;
}

export const SnackbarAction = React.forwardRef<HTMLButtonElement, SnackbarActionProps>(
  ({ asChild = false, className, altText, children, ...props }, ref) => {
    const classes = cn(
      'flex-shrink-0 rounded-shape-xs px-3 py-1',
      'text-label-l text-inverse-primary',
      'transition-colors duration-200 ease-standard',
      'hover:bg-on-surface/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-primary',
      className,
    );

    if (asChild) {
      // Hand off to Radix's `asChild` mechanism: the consumer's element
      // becomes the rendered button.
      return (
        <ToastPrimitive.Action altText={altText} asChild>
          <Slot ref={ref as React.Ref<HTMLButtonElement>} className={classes} {...props}>
            {children}
          </Slot>
        </ToastPrimitive.Action>
      );
    }

    return (
      <ToastPrimitive.Action
        ref={ref as React.Ref<HTMLButtonElement>}
        altText={altText}
        className={classes}
        {...props}
      >
        {children}
      </ToastPrimitive.Action>
    );
  },
);
SnackbarAction.displayName = 'SnackbarAction';

/** shadcn-style alias for `<SnackbarProvider>`. */
export const Toaster = SnackbarProvider;

/**
 * Backwards-compatible namespace — `<Snackbar.Provider>` continues to work.
 * New code should prefer the named exports (`SnackbarProvider`, `useSnackbar`).
 */
export const Snackbar = {
  Provider: SnackbarProvider,
  Action: SnackbarAction,
};

export { snackbarVariants };
export type { SnackbarVariant };
