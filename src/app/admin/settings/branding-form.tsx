'use client';

import React, { useTransition, useState, useCallback } from 'react';
import type { User } from 'lucia';

import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useSnackbar } from '@/components/ui/Snackbar';
import { useTheme } from '@/lib/theme/provider';
import { updateBrandingSettings, type SettingsActionResult } from './actions';

interface BrandingFormProps {
  user: User;
}

const INITIAL_STATE: SettingsActionResult = { success: false };

const PRESET_COLORS = [
  { hex: '#4F6CFF', label: 'Indigo' },
  { hex: '#16A34A', label: 'Green' },
  { hex: '#DC2626', label: 'Red' },
  { hex: '#9333EA', label: 'Purple' },
  { hex: '#F59E0B', label: 'Amber' },
];

const THEME_OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BrandingForm({ user }: BrandingFormProps) {
  const snackbar = useSnackbar();
  const { setSeedColor, setTheme } = useTheme();
  const [isPending, startTransition] = useTransition();

  const [color, setColor] = useState(user.seedColor);
  const [hexInput, setHexInput] = useState(user.seedColor);
  const [hexError, setHexError] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState(user.theme);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (hexError) return;
      const formData = new FormData(e.currentTarget);
      startTransition(async () => {
        const result = await updateBrandingSettings(INITIAL_STATE, formData);
        if (result.success) {
          snackbar.show({ message: 'Branding saved.' });
        } else if (result.error) {
          snackbar.show({ message: result.error });
        }
      });
    },
    [snackbar, hexError],
  );

  const applyColor = (hex: string) => {
    setColor(hex);
    setHexInput(hex);
    setHexError(false);
    setSeedColor(hex);
  };

  const handleHexChange = (val: string) => {
    setHexInput(val);
    if (HEX_RE.test(val)) {
      setHexError(false);
      setColor(val);
      setSeedColor(val);
    } else {
      setHexError(true);
    }
  };

  const handleThemeChange = (val: string) => {
    setSelectedTheme(val);
    setTheme(val as 'light' | 'dark' | 'system');
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="seedColor" value={color} />
      <input type="hidden" name="theme" value={selectedTheme} />

      <div className="flex flex-col gap-3">
        <p className="text-label-m text-on-surface-variant">Accent color</p>
        <div className="flex flex-wrap gap-3">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              aria-label={preset.label}
              title={preset.label}
              onClick={() => applyColor(preset.hex)}
              className={[
                'h-9 w-9 rounded-full border-2 transition-all',
                color === preset.hex
                  ? 'border-on-surface scale-110'
                  : 'border-transparent hover:scale-105',
              ].join(' ')}
              style={{ backgroundColor: preset.hex }}
            />
          ))}
        </div>
        <TextField
          label="Custom hex color"
          value={hexInput}
          onChange={handleHexChange}
          error={hexError}
          helperText={hexError ? 'Enter a valid 6-digit hex color like #4F6CFF' : undefined}
          placeholder="#4F6CFF"
        />
      </div>

      <Select
        label="Theme"
        name="theme-select"
        defaultValue={selectedTheme}
        options={THEME_OPTIONS}
        onValueChange={handleThemeChange}
      />

      <div className="flex justify-end">
        <Button type="submit" variant="filled" loading={isPending} disabled={hexError}>
          Save branding
        </Button>
      </div>
    </form>
  );
}
