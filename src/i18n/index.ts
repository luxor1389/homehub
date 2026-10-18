import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import srLatn from './locales/sr-Latn.json';
import en from './locales/en.json';
import type { Locale } from '@/lib/types';

export const LOCALES: Locale[] = ['sr-Latn', 'en'];
const STORAGE_KEY = 'homehub.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'sr-Latn') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'sr-Latn'; // Serbian (Latin) is the default UI language
}

void i18n.use(initReactI18next).init({
  resources: { 'sr-Latn': { translation: srLatn }, en: { translation: en } },
  lng: initialLocale(),
  fallbackLng: 'sr-Latn',
  supportedLngs: LOCALES,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function applyLocale(locale: Locale) {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export default i18n;
