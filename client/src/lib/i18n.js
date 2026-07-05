// i18next setup. Two languages: Hebrew (the app's original, RTL) and English
// (LTR). Language is chosen once at sign-up and stored on the account; there is
// no in-app switcher. The pre-auth default is Hebrew — auth.jsx calls applyLang()
// with the account language once the user is known.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from '../locales/he.json';
import en from '../locales/en.json';

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  lng: 'he',
  fallbackLng: 'he',
  // React already escapes output, so i18next must not double-escape.
  interpolation: {
    escapeValue: false,
    // Locale-aware number/date formatting used from translation strings via the
    // {{value, formatName}} syntax — e.g. t('x', { d: isoDate }) with "{{d, date}}".
    format(value, format, lng) {
      if (value == null) return '';
      if (format === 'date') {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d)) return String(value);
        return new Intl.DateTimeFormat(lng, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
      }
      if (format === 'weekday') {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d)) return String(value);
        return new Intl.DateTimeFormat(lng, { weekday: 'long' }).format(d);
      }
      return String(value);
    },
  },
});

// Apply a language to i18next AND to the document: <html lang/dir> so the whole
// UI flips between RTL (Hebrew) and LTR (English). Call on login/session-restore.
export function applyLang(lang) {
  const l = lang === 'en' ? 'en' : 'he';
  const dir = l === 'en' ? 'ltr' : 'rtl';
  if (i18n.language !== l) i18n.changeLanguage(l);
  const root = document.documentElement;
  root.setAttribute('lang', l);
  root.setAttribute('dir', dir);
}

export default i18n;
