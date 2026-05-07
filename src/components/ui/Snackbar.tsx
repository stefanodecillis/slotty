'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { cn } from '@/lib/utils/cn';

interface SnackbarItem {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface SnackbarContextValue {
  show: (item: Omit<SnackbarItem, 'id'>) => void;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext);
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
  const [items, setItems] = useState<SnackbarItem[]>([]);
  const counterRef = useRef(0);

  const show = useCallback((item: Omit<SnackbarItem, 'id'>) => {
    const id = `snackbar-${++counterRef.current}`;
    setItems((prev) => [...prev, { ...item, id }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return (
    <SnackbarContext.Provider value={{ show }}>
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

interface SnackbarToastProps {
  item: SnackbarItem;
  onOpenChange: (open: boolean) => void;
}

function SnackbarToast({ item, onOpenChange }: SnackbarToastProps) {
  return (
    <ToastPrimitive.Root
      open
      duration={item.duration ?? 4000}
      onOpenChange={onOpenChange}
      className={cn(
        'group flex items-center justify-between gap-4',
        'rounded-shape-xs bg-inverse-surface px-4 py-3',
        'shadow-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4',
        'transition-all duration-300 ease-emphasized',
        'data-[swipe=end]:translate-y-[var(--radix-toast-swipe-end-y)] data-[swipe=move]:translate-y-[var(--radix-toast-swipe-move-y)]',
        'data-[swipe=cancel]:translate-y-0 data-[swipe=end]:animate-out',
      )}
    >
      <ToastPrimitive.Description className="flex-1 text-body-m text-inverse-on-surface">
        {item.message}
      </ToastPrimitive.Description>

      {item.actionLabel && (
        <ToastPrimitive.Action
          altText={item.actionLabel}
          onClick={item.onAction}
          className={cn(
            'flex-shrink-0 rounded-shape-xs px-3 py-1',
            'text-label-l text-inverse-primary',
            'transition-colors duration-200 ease-standard',
            'hover:bg-on-surface/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-primary',
          )}
        >
          {item.actionLabel}
        </ToastPrimitive.Action>
      )}
    </ToastPrimitive.Root>
  );
}

export const Snackbar = {
  Provider: SnackbarProvider,
};
