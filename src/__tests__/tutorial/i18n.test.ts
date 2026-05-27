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
  it('returns es for Spanish locales', () => {
    setLanguage('es-AR')
    expect(resolveTutorialLocale()).toBe('es')
    setLanguage('es')
    expect(resolveTutorialLocale()).toBe('es')
  })

  it('returns en for everything else (English default)', () => {
    setLanguage('en-US')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('pt-BR')
    expect(resolveTutorialLocale()).toBe('en')
    setLanguage('')
    expect(resolveTutorialLocale()).toBe('en')
  })
})

describe('t', () => {
  const phrase: Localized = { en: 'Create', es: 'Crear' }

  it('picks the string for the resolved locale by default', () => {
    setLanguage('es-AR')
    expect(t(phrase)).toBe('Crear')
    setLanguage('en-US')
    expect(t(phrase)).toBe('Create')
  })

  it('honors an explicit locale argument', () => {
    expect(t(phrase, 'es')).toBe('Crear')
    expect(t(phrase, 'en')).toBe('Create')
  })
})
