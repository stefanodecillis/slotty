'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { generateTheme, themeToCss } from './generate';
import type { ThemeMode } from './tokens';

const STORAGE_KEY_MODE = 'slotty-theme-mode';
const STORAGE_KEY_SEED = 'slotty-theme-seed';
const DEFAULT_SEED = '#4F6CFF';
const STYLE_ELEMENT_ID = 'm3-tokens';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  seedColor: string;
  setSeedColor: (hex: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(STORAGE_KEY_MODE);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function getStoredSeed(): string {
  if (typeof window === 'undefined') return DEFAULT_SEED;
  return localStorage.getItem(STORAGE_KEY_SEED) ?? DEFAULT_SEED;
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function applyThemeAttribute(mode: ThemeMode): void {
  const resolved = resolveMode(mode);
  if (resolved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function applyTokens(seedHex: string): void {
  const theme = generateTheme(seedHex);
  const css = themeToCss(theme);
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultSeed?: string;
}

export function ThemeProvider({ children, defaultSeed = DEFAULT_SEED }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [seedColor, setSeedColorState] = useState<string>(defaultSeed);
  const themeRef = useRef<ThemeMode>('system');

  useEffect(() => {
    const storedMode = getStoredMode();
    const storedSeed = getStoredSeed();
    themeRef.current = storedMode;
    setThemeState(storedMode);
    setSeedColorState(storedSeed);
    applyThemeAttribute(storedMode);
    applyTokens(storedSeed);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      if (themeRef.current === 'system') {
        applyThemeAttribute('system');
      }
    };

    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    themeRef.current = mode;
    setThemeState(mode);
    localStorage.setItem(STORAGE_KEY_MODE, mode);
    applyThemeAttribute(mode);
  }, []);

  const setSeedColor = useCallback((hex: string) => {
    setSeedColorState(hex);
    localStorage.setItem(STORAGE_KEY_SEED, hex);
    applyTokens(hex);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, seedColor, setSeedColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ThemeScript is a server component — it renders a static inline script that
// reads localStorage before React hydrates to prevent FOUC. The script content
// is entirely static (no user data injected), so XSS is not a concern.
export function ThemeScript() {
  const noFlashScript = [
    '(function(){',
    "  try{var m=localStorage.getItem('slotty-theme-mode')||'system';",
    "  var r=m==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):m;",
    "  if(r==='dark')document.documentElement.setAttribute('data-theme','dark');",
    '  }catch(e){}',
    '})();',
  ].join('');

  return (
    <script
      suppressHydrationWarning
      // Static string — no user input, safe.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: noFlashScript }}
    />
  );
}
