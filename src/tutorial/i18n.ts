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

/**
 * The tutorial displays in English to match the English-only app UI (and the
 * international launch). Copy is still authored bilingually (the `es` strings
 * stay in the tour defs) so re-enabling locale detection is a one-line change.
 */
export function resolveTutorialLocale(): Locale {
  return 'en'
}

/** Pick the string for `locale` (defaults to the resolved locale). */
export function t(value: Localized, locale: Locale = resolveTutorialLocale()): string {
  return value[locale]
}
