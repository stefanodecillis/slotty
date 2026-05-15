/**
 * Hex → HSL tuple in the space-separated Tailwind/shadcn format ("H S% L%").
 *
 * shadcn's CSS variables (--primary, --accent, …) are consumed as
 * `hsl(var(--primary))`, so the variable value must be the *components only*
 * (no "hsl()" wrapper). This helper produces exactly that shape so the public
 * booking page can override the theme primary with the brand's color by
 * inlining a single `style={{ '--primary': hexToHsl(brand.primaryColor) }}`
 * on a wrapper div.
 */
export function hexToHsl(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return '0 0% 0%';
  const r = parseInt(m[1]!, 16) / 255;
  const g = parseInt(m[2]!, 16) / 255;
  const b = parseInt(m[3]!, 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Pick black or white as the readable foreground for a given hex background,
 * using the WCAG relative-luminance threshold of 0.5. Returns the HSL
 * components, not "hsl(...)".
 */
export function readableForegroundHsl(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return '0 0% 100%';
  const channels = [m[1]!, m[2]!, m[3]!].map((c) => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  return luminance > 0.5 ? '240 10% 3.9%' : '0 0% 98%';
}
