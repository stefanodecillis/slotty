export enum ColorRole {
  Primary = 'primary',
  OnPrimary = 'on-primary',
  PrimaryContainer = 'primary-container',
  OnPrimaryContainer = 'on-primary-container',
  Secondary = 'secondary',
  OnSecondary = 'on-secondary',
  SecondaryContainer = 'secondary-container',
  OnSecondaryContainer = 'on-secondary-container',
  Tertiary = 'tertiary',
  OnTertiary = 'on-tertiary',
  TertiaryContainer = 'tertiary-container',
  OnTertiaryContainer = 'on-tertiary-container',
  Error = 'error',
  OnError = 'on-error',
  ErrorContainer = 'error-container',
  OnErrorContainer = 'on-error-container',
  Background = 'background',
  OnBackground = 'on-background',
  Surface = 'surface',
  OnSurface = 'on-surface',
  SurfaceVariant = 'surface-variant',
  OnSurfaceVariant = 'on-surface-variant',
  SurfaceDim = 'surface-dim',
  SurfaceBright = 'surface-bright',
  SurfaceContainerLowest = 'surface-container-lowest',
  SurfaceContainerLow = 'surface-container-low',
  SurfaceContainer = 'surface-container',
  SurfaceContainerHigh = 'surface-container-high',
  SurfaceContainerHighest = 'surface-container-highest',
  Outline = 'outline',
  OutlineVariant = 'outline-variant',
  Scrim = 'scrim',
  InverseSurface = 'inverse-surface',
  InverseOnSurface = 'inverse-on-surface',
  InversePrimary = 'inverse-primary',
}

export enum TypeRole {
  DisplayLarge = 'display-l',
  DisplayMedium = 'display-m',
  DisplaySmall = 'display-s',
  HeadlineLarge = 'headline-l',
  HeadlineMedium = 'headline-m',
  HeadlineSmall = 'headline-s',
  TitleLarge = 'title-l',
  TitleMedium = 'title-m',
  TitleSmall = 'title-s',
  BodyLarge = 'body-l',
  BodyMedium = 'body-m',
  BodySmall = 'body-s',
  LabelLarge = 'label-l',
  LabelMedium = 'label-m',
  LabelSmall = 'label-s',
}

export enum ShapeScale {
  None = 'none',
  ExtraSmall = 'shape-xs',
  Small = 'shape-sm',
  Medium = 'shape-md',
  Large = 'shape-lg',
  ExtraLarge = 'shape-xl',
  Full = 'full',
}

export enum ElevationLevel {
  Level0 = 0,
  Level1 = 1,
  Level2 = 2,
  Level3 = 3,
  Level4 = 4,
  Level5 = 5,
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeVars {
  lightVars: Record<string, string>;
  darkVars: Record<string, string>;
}

export interface ThemeTokens {
  colorRole: typeof ColorRole;
  typeRole: typeof TypeRole;
  shapeScale: typeof ShapeScale;
  elevationLevel: typeof ElevationLevel;
}
