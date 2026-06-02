// src/__tests__/tutorial/i18n.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { resolveTutorialLocale, t, type Localized } from '../../tutorial/i18n'

function setLanguage(value: string) {
  Object.defineProperty(navigator, 'language', { value, configurable: true })
}

afterEach(() => {
  setLanguage('en-US')
})

describe('resolveTutorialLocale', () => {
  it('always returns en (tutorial is English-only) regardless of browser locale', () => {
    setLanguage('es-AR')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('es')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('pt-BR')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('')
    expect(resolveTutorialLocale()).toBe('en')
  })
})

describe('t', () => {
  const phrase: Localized = { en: 'Create', es: 'Crear' }

  it('defaults to English (the resolved locale) even on a Spanish browser', () => {
    setLanguage('es-AR')
    expect(t(phrase)).toBe('Create')
  })

  it('honors an explicit locale argument', () => {
    expect(t(phrase, 'es')).toBe('Crear')
    expect(t(phrase, 'en')).toBe('Create')
  })
})
