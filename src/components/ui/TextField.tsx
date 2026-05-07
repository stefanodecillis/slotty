'use client';

import React, { forwardRef, useId, useState } from 'react';
import { cn } from '@/lib/utils/cn';

export interface TextFieldProps {
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  error?: boolean;
  helperText?: string;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  type?: React.HTMLInputTypeAttribute;
  name?: string;
  id?: string;
  className?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}

export const TextField = forwardRef<HTMLInputElement | HTMLTextAreaElement, TextFieldProps>(
  (
    {
      label,
      value,
      defaultValue,
      onChange,
      error = false,
      helperText,
      leadingIcon,
      trailingIcon,
      multiline = false,
      rows = 4,
      required = false,
      disabled = false,
      placeholder,
      type = 'text',
      name,
      id: idProp,
      className,
      autoComplete,
      autoFocus,
    },
    ref,
  ) => {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const helperId = `${id}-helper`;

    const [internalValue, setInternalValue] = useState(defaultValue ?? '');
    const [focused, setFocused] = useState(false);

    const controlled = value !== undefined;
    const currentValue = controlled ? value : internalValue;

    const isFloating = focused || currentValue.length > 0 || Boolean(placeholder);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!controlled) setInternalValue(e.target.value);
      onChange?.(e.target.value);
    };

    const borderClass = error
      ? focused
        ? 'border-2 border-error'
        : 'border border-error'
      : focused
        ? 'border-2 border-primary'
        : 'border border-outline';

    const labelColorClass = error ? 'text-error' : focused ? 'text-primary' : 'text-on-surface-variant';

    const inputPaddingLeft = leadingIcon ? 'pl-12' : 'pl-4';
    const inputPaddingRight = trailingIcon ? 'pr-12' : 'pr-4';

    const sharedInputClass = cn(
      'w-full bg-transparent text-body-l text-on-surface outline-none',
      'placeholder:text-on-surface-variant/60',
      'disabled:cursor-not-allowed',
      inputPaddingLeft,
      inputPaddingRight,
    );

    return (
      <div className={cn('relative flex flex-col gap-1', className)}>
        <div
          className={cn(
            'relative flex items-center rounded-shape-xs bg-transparent',
            'transition-colors duration-200 ease-standard',
            borderClass,
            disabled && 'opacity-38',
          )}
        >
          {leadingIcon && (
            <span className="absolute left-3 flex items-center text-[20px] text-on-surface-variant">
              {leadingIcon}
            </span>
          )}

          {/* Floating label */}
          <label
            htmlFor={id}
            className={cn(
              'pointer-events-none absolute select-none',
              leadingIcon ? 'left-12' : 'left-4',
              'transition-all duration-200 ease-emphasized',
              isFloating
                ? cn(
                    'top-0 -translate-y-1/2 px-1 text-label-m',
                    'bg-surface',
                  )
                : 'top-1/2 -translate-y-1/2 text-body-l',
              labelColorClass,
            )}
          >
            {label}
            {required && <span aria-hidden="true"> *</span>}
          </label>

          {multiline ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              id={id}
              name={name}
              rows={rows}
              required={required}
              disabled={disabled}
              value={controlled ? value : internalValue}
              onChange={handleChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={focused ? (placeholder ?? '') : ''}
              autoComplete={autoComplete}
              autoFocus={autoFocus}
              aria-invalid={error}
              aria-describedby={helperText ? helperId : undefined}
              className={cn(sharedInputClass, 'resize-none py-4')}
            />
          ) : (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              id={id}
              name={name}
              type={type}
              required={required}
              disabled={disabled}
              value={controlled ? value : internalValue}
              onChange={handleChange}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={focused ? (placeholder ?? '') : ''}
              autoComplete={autoComplete}
              autoFocus={autoFocus}
              aria-invalid={error}
              aria-describedby={helperText ? helperId : undefined}
              className={cn(sharedInputClass, 'h-14')}
            />
          )}

          {trailingIcon && (
            <span className="absolute right-3 flex items-center text-[20px] text-on-surface-variant">
              {trailingIcon}
            </span>
          )}
        </div>

        {helperText && (
          <p
            id={helperId}
            className={cn('px-4 text-body-s', error ? 'text-error' : 'text-on-surface-variant')}
          >
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

TextField.displayName = 'TextField';
