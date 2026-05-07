'use client';

import React, { useId, useState, useMemo } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '@/lib/utils/cn';

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

export function Select({
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
  const id = useId();
  const helperId = `${id}-helper`;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, searchable]);

  // Find displayed label for the current value
  const selectedLabel = useMemo(() => {
    const currentVal = value ?? defaultValue;
    if (!currentVal) return placeholder ?? '';
    return options.find((o) => o.value === currentVal)?.label ?? currentVal;
  }, [value, defaultValue, options, placeholder]);

  const hasValue = Boolean(value ?? defaultValue);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setSearch('');
  };

  return (
    <div className="relative flex flex-col gap-1">
      <SelectPrimitive.Root
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
          {/* Floating label */}
          <label
            htmlFor={id}
            className={cn(
              'pointer-events-none absolute left-4 select-none transition-all duration-200 ease-emphasized z-10',
              hasValue || open
                ? 'top-0 -translate-y-1/2 px-1 text-label-m bg-surface'
                : 'top-1/2 -translate-y-1/2 text-body-l',
              open ? 'text-primary' : 'text-on-surface-variant',
              disabled && 'opacity-38',
            )}
          >
            {label}
            {required && <span aria-hidden="true"> *</span>}
          </label>

          <SelectPrimitive.Trigger
            id={id}
            aria-describedby={helperText ? helperId : undefined}
            className={cn(
              'flex w-full items-center justify-between',
              'h-14 rounded-shape-xs px-4 text-left',
              'text-body-l text-on-surface',
              'border transition-colors duration-200 ease-standard outline-none',
              open ? 'border-2 border-primary' : 'border border-outline',
              'bg-transparent',
              'focus-visible:border-2 focus-visible:border-primary',
              disabled && 'cursor-not-allowed opacity-38',
            )}
          >
            <SelectPrimitive.Value aria-label={selectedLabel}>
              <span className={cn(!hasValue && 'text-on-surface-variant/60')}>
                {hasValue ? selectedLabel : (placeholder ?? '')}
              </span>
            </SelectPrimitive.Value>
            <SelectPrimitive.Icon asChild>
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
                arrow_drop_down
              </span>
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
        </div>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className={cn(
              'relative z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden',
              'rounded-shape-sm bg-surface-container-low shadow-lg',
              'border border-outline-variant',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
              'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
            )}
          >
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
            <SelectPrimitive.Viewport className="max-h-60 overflow-y-auto p-1">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-2 text-body-m text-on-surface-variant">
                  No options found
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    className={cn(
                      'relative flex cursor-pointer select-none items-center',
                      'rounded-shape-xs px-3 py-2 text-body-m text-on-surface outline-none',
                      'transition-colors duration-100',
                      'data-[highlighted]:bg-on-surface/[0.08]',
                      'data-[state=checked]:text-primary',
                    )}
                  >
                    <SelectPrimitive.ItemIndicator asChild>
                      <span className="material-symbols-outlined absolute left-1 text-[18px] text-primary">
                        check
                      </span>
                    </SelectPrimitive.ItemIndicator>
                    <span className="pl-5">
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    </span>
                  </SelectPrimitive.Item>
                ))
              )}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>

      {helperText && (
        <p id={helperId} className="px-4 text-body-s text-on-surface-variant">
          {helperText}
        </p>
      )}
    </div>
  );
}
