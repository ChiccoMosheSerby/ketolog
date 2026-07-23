import { useEffect, useState } from 'react';

// Light/dark theme. Dark is the default; the choice persists in localStorage
// and is applied to <html data-theme> (see the inline boot script in index.html
// that sets it before first paint to avoid a flash).
const KEY = 'ketolog:theme';
// Mobile browser-chrome colour per theme — matches --paper.
const META = { dark: '#0a0b0b', light: '#149a5e' };

export function currentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META[theme] || META.dark);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — runtime toggle still works for this session */
  }
  // keep every useTheme() instance in sync (menu toggle + settings toggle)
  window.dispatchEvent(new Event('ketolog:themeChanged'));
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  // re-read when any other component switches the theme
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    window.addEventListener('ketolog:themeChanged', sync);
    return () => window.removeEventListener('ketolog:themeChanged', sync);
  }, []);
  function toggle() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }
  return { theme, toggle };
}
