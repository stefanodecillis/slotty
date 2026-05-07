'use client';

import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme/provider';

const SEED_PRESETS = [
  { hex: '#4F6CFF', label: 'Slate blue' },
  { hex: '#0F766E', label: 'Teal' },
  { hex: '#B91C1C', label: 'Crimson' },
  { hex: '#A16207', label: 'Amber' },
  { hex: '#7C3AED', label: 'Violet' },
];

export function ThemeControls() {
  const { theme, setTheme, seedColor, setSeedColor } = useTheme();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-label-l text-on-surface-variant">Theme</span>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <Button
              key={mode}
              variant={theme === mode ? 'filled' : 'outlined'}
              onClick={() => setTheme(mode)}
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label-l text-on-surface-variant">Seed color</span>
        <div className="flex flex-wrap gap-2">
          {SEED_PRESETS.map((preset) => {
            const active = preset.hex.toLowerCase() === seedColor.toLowerCase();
            return (
              <button
                key={preset.hex}
                type="button"
                onClick={() => setSeedColor(preset.hex)}
                aria-label={`Use ${preset.label} as seed color`}
                className={`h-10 w-10 rounded-full border-2 transition-transform duration-200 ease-emphasized ${
                  active
                    ? 'border-on-surface scale-110'
                    : 'border-outline-variant hover:scale-105'
                }`}
                style={{ backgroundColor: preset.hex }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
