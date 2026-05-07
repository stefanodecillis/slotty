'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@/lib/utils/cn';

// ───────────────────────────────────────────────────────────────────────────
// Canonical Radix-shadcn primitives — named exports.
// ───────────────────────────────────────────────────────────────────────────

const SelectRoot = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex w-full items-center justify-between',
      'h-14 rounded-shape-xs px-4 text-left',
      'text-body-l text-on-surface bg-transparent',
      'border border-outline transition-colors duration-200 ease-standard outline-none',
      'data-[state=open]:border-2 data-[state=open]:border-primary',
      'focus-visible:border-2 focus-visible:border-primary',
      'disabled:cursor-not-allowed disabled:opacity-38',
      'aria-[invalid=true]:border-error',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
        arrow_drop_down
      </span>
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', sideOffset = 4, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={sideOffset}
      className={cn(
        'relative z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden',
        'rounded-shape-sm bg-surface-container-low shadow-lg',
        'border border-outline-variant',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-60 overflow-y-auto p-1">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center',
      'rounded-shape-xs px-3 py-2 text-body-m text-on-surface outline-none',
      'transition-colors duration-100',
      'data-[highlighted]:bg-on-surface/[0.08]',
      'data-[state=checked]:text-primary',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-38',
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemIndicator asChild>
      <span className="material-symbols-outlined absolute left-1 text-[18px] text-primary">
        check
      </span>
    </SelectPrimitive.ItemIndicator>
    <span className="pl-5">
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </span>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-3 py-1.5 text-label-m text-on-surface-variant', className)}
    {...props}
  />
));
SelectLabel.displayName = 'SelectLabel';

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-outline-variant', className)}
    {...props}
  />
));
SelectSeparator.displayName = 'SelectSeparator';

// ───────────────────────────────────────────────────────────────────────────
// High-level wrapper — floating-label + searchable.
// ───────────────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  helperText?: string;
  disabled?: boolean;
  searchable?: boolean;
  name?: string;
  required?: boolean;
  placeholder?: string;
}

/**
 * High-level wrapper that mirrors `<TextField>`'s floating-label semantics.
 * For finer control, use the named `<SelectRoot>` / `<SelectTrigger>` /
 * `<SelectContent>` / `<SelectItem>` exports directly.
 *
 * Floating-label rule (matches TextField):
 *  - Empty value AND closed → label is centered (resting).
 *  - Open OR non-empty value → label floats (chip on the border).
 */
function Select({
  label,
  value,
  defaultValue,
  onValueChange,
  options,
  helperText,
  disabled = false,
  searchable = false,
  name,
  required = false,
  placeholder,
}: SelectProps) {
  const id = React.useId();
  const helperId = `${id}-helper`;
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const filteredOptions = React.useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, searchable]);

  const selectedLabel = React.useMemo(() => {
    const currentVal = value ?? defaultValue;
    if (!currentVal) return placeholder ?? '';
    return options.find((o) => o.value === currentVal)?.label ?? currentVal;
  }, [value, defaultValue, options, placeholder]);

  const hasValue = Boolean(value ?? defaultValue);
  const labelFloating = hasValue || open;

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setSearch('');
  };

  return (
    <div className="relative flex flex-col gap-1">
      <SelectRoot
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        open={open}
        onOpenChange={handleOpenChange}
        disabled={disabled}
        name={name}
        required={required}
      >
        <div className="relative">
          {/* Floating label — uses an explicit boolean rather than peer
              tricks because Radix's trigger does not expose a placeholder. */}
          <label
            htmlFor={id}
            className={cn(
              'pointer-events-none absolute select-none transition-all duration-200 ease-emphasized z-10',
              labelFloating
                ? 'top-0 left-4 -translate-y-1/2 px-1 text-label-m bg-surface-container-low'
                : 'top-1/2 left-4 -translate-y-1/2 text-body-l',
              open
                ? 'text-primary'
                : labelFloating
                  ? 'text-on-surface-variant'
                  : 'text-on-surface-variant',
              disabled && 'opacity-38',
            )}
          >
            {label}
            {required && <span aria-hidden="true"> *</span>}
          </label>

          <SelectTrigger
            id={id}
            aria-describedby={helperText ? helperId : undefined}
          >
            <SelectValue aria-label={selectedLabel}>
              <span className={cn(!hasValue && 'text-on-surface-variant/60')}>
                {hasValue ? selectedLabel : (placeholder ?? '')}
              </span>
            </SelectValue>
          </SelectTrigger>
        </div>

        <SelectContent>
          {searchable && (
            <div className="sticky top-0 border-b border-outline-variant bg-surface-container-low p-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                onKeyDown={(e) => e.stopPropagation()}
                className={cn(
                  'w-full rounded-shape-xs border border-outline bg-transparent',
                  'px-3 py-2 text-body-m text-on-surface outline-none',
                  'placeholder:text-on-surface-variant/60',
                  'focus:border-primary',
                )}
                autoFocus
              />
            </div>
          )}
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-body-m text-on-surface-variant">
              No options found
            </div>
          ) : (
            filteredOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </SelectRoot>

      {helperText && (
        <p id={helperId} className="px-4 text-body-s text-on-surface-variant">
          {helperText}
        </p>
      )}
    </div>
  );
}

Select.displayName = 'Select';

export {
  Select,
  SelectRoot,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
};
