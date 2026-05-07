import {
  argbFromHex,
  DynamicScheme,
  MaterialDynamicColors,
  Hct,
  SchemeTonalSpot,
} from '@material/material-color-utilities';

import type { ThemeVars } from './tokens';

function argbToRgbChannels(argb: number): string {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `${r} ${g} ${b}`;
}

const COLOR_ROLE_MAP: Record<string, (scheme: DynamicScheme) => number> = {
  primary: (s) => MaterialDynamicColors.primary.getArgb(s),
  'on-primary': (s) => MaterialDynamicColors.onPrimary.getArgb(s),
  'primary-container': (s) => MaterialDynamicColors.primaryContainer.getArgb(s),
  'on-primary-container': (s) => MaterialDynamicColors.onPrimaryContainer.getArgb(s),
  secondary: (s) => MaterialDynamicColors.secondary.getArgb(s),
  'on-secondary': (s) => MaterialDynamicColors.onSecondary.getArgb(s),
  'secondary-container': (s) => MaterialDynamicColors.secondaryContainer.getArgb(s),
  'on-secondary-container': (s) => MaterialDynamicColors.onSecondaryContainer.getArgb(s),
  tertiary: (s) => MaterialDynamicColors.tertiary.getArgb(s),
  'on-tertiary': (s) => MaterialDynamicColors.onTertiary.getArgb(s),
  'tertiary-container': (s) => MaterialDynamicColors.tertiaryContainer.getArgb(s),
  'on-tertiary-container': (s) => MaterialDynamicColors.onTertiaryContainer.getArgb(s),
  error: (s) => MaterialDynamicColors.error.getArgb(s),
  'on-error': (s) => MaterialDynamicColors.onError.getArgb(s),
  'error-container': (s) => MaterialDynamicColors.errorContainer.getArgb(s),
  'on-error-container': (s) => MaterialDynamicColors.onErrorContainer.getArgb(s),
  background: (s) => MaterialDynamicColors.background.getArgb(s),
  'on-background': (s) => MaterialDynamicColors.onBackground.getArgb(s),
  surface: (s) => MaterialDynamicColors.surface.getArgb(s),
  'on-surface': (s) => MaterialDynamicColors.onSurface.getArgb(s),
  'surface-variant': (s) => MaterialDynamicColors.surfaceVariant.getArgb(s),
  'on-surface-variant': (s) => MaterialDynamicColors.onSurfaceVariant.getArgb(s),
  'surface-dim': (s) => MaterialDynamicColors.surfaceDim.getArgb(s),
  'surface-bright': (s) => MaterialDynamicColors.surfaceBright.getArgb(s),
  'surface-container-lowest': (s) => MaterialDynamicColors.surfaceContainerLowest.getArgb(s),
  'surface-container-low': (s) => MaterialDynamicColors.surfaceContainerLow.getArgb(s),
  'surface-container': (s) => MaterialDynamicColors.surfaceContainer.getArgb(s),
  'surface-container-high': (s) => MaterialDynamicColors.surfaceContainerHigh.getArgb(s),
  'surface-container-highest': (s) => MaterialDynamicColors.surfaceContainerHighest.getArgb(s),
  outline: (s) => MaterialDynamicColors.outline.getArgb(s),
  'outline-variant': (s) => MaterialDynamicColors.outlineVariant.getArgb(s),
  scrim: (s) => MaterialDynamicColors.scrim.getArgb(s),
  'inverse-surface': (s) => MaterialDynamicColors.inverseSurface.getArgb(s),
  'inverse-on-surface': (s) => MaterialDynamicColors.inverseOnSurface.getArgb(s),
  'inverse-primary': (s) => MaterialDynamicColors.inversePrimary.getArgb(s),
};

function schemeToVars(scheme: DynamicScheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [role, getter] of Object.entries(COLOR_ROLE_MAP)) {
    vars[`--md-sys-color-${role}`] = argbToRgbChannels(getter(scheme));
  }
  return vars;
}

export function generateTheme(seedHex: string): ThemeVars {
  const sourceArgb = argbFromHex(seedHex);
  const sourceHct = Hct.fromInt(sourceArgb);

  const lightScheme = new SchemeTonalSpot(sourceHct, false, 0.0);
  const darkScheme = new SchemeTonalSpot(sourceHct, true, 0.0);

  return {
    lightVars: schemeToVars(lightScheme),
    darkVars: schemeToVars(darkScheme),
  };
}

export function themeToCss(theme: ThemeVars): string {
  const lightLines = Object.entries(theme.lightVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  const darkLines = Object.entries(theme.darkVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  return `:root {\n${lightLines}\n}\n\n[data-theme="dark"] {\n${darkLines}\n}\n`;
}
