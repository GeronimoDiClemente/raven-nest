import { describe, it, expect } from 'vitest'
import { shouldShowMemoriesWelcome } from '../../lib/memoriesWelcome'

const base = {
  memoriesOpen: true,
  abiertaEnSettings: false,
  forced: false,
  hasSeenMemoriesWelcome: false,
  e2eBypass: false,
}

describe('shouldShowMemoriesWelcome', () => {
  it('shows it the first time Memories opens on the memorias view', () => {
    expect(shouldShowMemoriesWelcome(base)).toBe(true)
  })

  it('never shows under e2eBypass unless forced — e2e specs open Memories constantly', () => {
    expect(shouldShowMemoriesWelcome({ ...base, e2eBypass: true })).toBe(false)
  })

  it('"How it works" (forced) shows even under e2eBypass', () => {
    expect(shouldShowMemoriesWelcome({ ...base, e2eBypass: true, forced: true })).toBe(true)
  })

  it('does not repeat once the user has already seen it', () => {
    expect(shouldShowMemoriesWelcome({ ...base, hasSeenMemoriesWelcome: true })).toBe(false)
  })

  it('"How it works" (forced) shows again even after it was seen', () => {
    expect(shouldShowMemoriesWelcome({ ...base, hasSeenMemoriesWelcome: true, forced: true })).toBe(true)
  })

  it('never shows while Memories itself is closed', () => {
    expect(shouldShowMemoriesWelcome({ ...base, memoriesOpen: false, forced: true })).toBe(false)
  })

  it('no se auto-muestra si Memories abrió desde Account → Memory settings, pero How it works sí', () => {
    expect(shouldShowMemoriesWelcome({ ...base, abiertaEnSettings: true })).toBe(false)
    expect(shouldShowMemoriesWelcome({ ...base, abiertaEnSettings: true, forced: true })).toBe(true)
  })
})
