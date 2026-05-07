'use client';

import React, { forwardRef, useId } from 'react';
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

/**
 * M3 outlined text field with floating label.
 *
 * The "floating" detection is CSS-based via `:placeholder-shown` and `:focus`
 * rather than React state — so it works correctly with browser autofill,
 * native form submission, and any uncontrolled use. We always render a
 * placeholder of `" "` (a single space) so `:placeholder-shown` reliably
 * matches the empty state.
 */
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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange?.(e.target.value);
    };

    const inputPaddingLeft = leadingIcon ? 'pl-12' : 'pl-4';
    const inputPaddingRight = trailingIcon ? 'pr-12' : 'pr-4';

    // Always pass a non-empty placeholder so :placeholder-shown reliably
    // matches the empty state. A user-supplied placeholder still works.
    const effectivePlaceholder = placeholder && placeholder.length > 0 ? placeholder : ' ';

    const sharedInputClass = cn(
      'peer w-full bg-transparent text-body-l text-on-surface outline-none',
      'placeholder:text-on-surface-variant/60',
      'disabled:cursor-not-allowed',
      // Drive border state via CSS:
      //   default (empty + not focused) → outline color
      //   focused                       → primary color, 2px
      //   error                         → error color
      // The border itself lives on the wrapper div; we only need the input
      // to expose its state via :focus (which the wrapper picks up via
      // focus-within).
      inputPaddingLeft,
      inputPaddingRight,
    );

    const wrapperBorderClass = error
      ? 'border border-error focus-within:border-2 focus-within:border-error'
      : 'border border-outline focus-within:border-2 focus-within:border-primary';

    // Floating label classes:
    //  - default state: floating (top-0, small, primary-on-focus)
    //  - input is empty AND unfocused: centered, body-l, on-surface-variant
    //
    // The peer modifier reads the input's :placeholder-shown / :focus state.
    // This works for autofilled inputs because once a value is present the
    // browser does NOT report :placeholder-shown.
    const labelClass = cn(
      'pointer-events-none absolute select-none',
      leadingIcon ? 'left-12' : 'left-4',
      'transition-all duration-200 ease-emphasized',
      // Floating (default) styling — applies unless overridden below
      'top-0 -translate-y-1/2 px-1 text-label-m',
      'bg-surface-container-low',
      // Resting (centered) styling when input is empty AND not focused
      'peer-placeholder-shown:top-1/2',
      'peer-placeholder-shown:-translate-y-1/2',
      'peer-placeholder-shown:text-body-l',
      'peer-placeholder-shown:bg-transparent',
      'peer-placeholder-shown:px-0',
      // Re-float on focus, even when empty
      'peer-focus:top-0',
      'peer-focus:-translate-y-1/2',
      'peer-focus:px-1',
      'peer-focus:text-label-m',
      'peer-focus:bg-surface-container-low',
      // Color
      error
        ? 'text-error peer-focus:text-error'
        : 'text-on-surface-variant peer-focus:text-primary',
    );

    const commonProps = {
      id,
      name,
      required,
      disabled,
      autoComplete,
      autoFocus,
      placeholder: effectivePlaceholder,
      'aria-invalid': error,
      'aria-describedby': helperText ? helperId : undefined,
      onChange: handleChange,
    };

    return (
      <div className={cn('relative flex flex-col gap-1', className)}>
        <div
          className={cn(
            'relative flex items-center rounded-shape-xs bg-transparent',
            'transition-colors duration-200 ease-standard',
            wrapperBorderClass,
            disabled && 'opacity-38',
          )}
        >
          {leadingIcon && (
            <span className="absolute left-3 z-10 flex items-center text-[20px] text-on-surface-variant">
              {leadingIcon}
            </span>
          )}

          {multiline ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              rows={rows}
              {...(value !== undefined
                ? { value }
                : defaultValue !== undefined
                  ? { defaultValue }
                  : {})}
              {...commonProps}
              className={cn(sharedInputClass, 'resize-none py-4')}
            />
          ) : (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              type={type}
              {...(value !== undefined
                ? { value }
                : defaultValue !== undefined
                  ? { defaultValue }
                  : {})}
              {...commonProps}
              className={cn(sharedInputClass, 'h-14')}
            />
          )}

          {/* Label is rendered AFTER the input so the `peer-*` Tailwind
              modifiers can read the input's :placeholder-shown / :focus state. */}
          <label htmlFor={id} className={labelClass}>
            {label}
            {required && <span aria-hidden="true"> *</span>}
          </label>

          {trailingIcon && (
            <span className="absolute right-3 z-10 flex items-center text-[20px] text-on-surface-variant">
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
