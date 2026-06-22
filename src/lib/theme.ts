export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'user-preferences-store';

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveThemeMode(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? getSystemTheme() : mode;
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveThemeMode(mode);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return 'system';
    const parsed = JSON.parse(raw) as { state?: { themeMode?: unknown } };
    const mode = parsed.state?.themeMode;
    return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
  } catch {
    return 'system';
  }
}
