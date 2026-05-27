// src/tutorial/i18n.ts
//
// Tutorial-scoped localization. The app UI is English-only; the tutorial is the
// one place we localize, so this stays a tiny module (no app-wide i18n, no dep).

export type Locale = 'en' | 'es'

/** A string available in the tutorial's supported locales. */
export interface Localized {
  en: string
  es: string
}

/** 'es' only when the browser locale is Spanish; English otherwise (app default). */
export function resolveTutorialLocale(): Locale {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return lang.toLowerCase().startsWith('es') ? 'es' : 'en'
}

/** Pick the string for `locale` (defaults to the resolved locale). */
export function t(value: Localized, locale: Locale = resolveTutorialLocale()): string {
  return value[locale]
}
