import { describe, it, expect } from 'vitest'
import { PRESETS, getPreset, type LayoutPreset, type Split } from '../../layout/presets'

function collectSlots(split: Split, out: number[] = []): number[] {
  if (split.kind === 'pane') { out.push(split.slot); return out }
  for (const c of split.children) collectSlots(c, out)
  return out
}

describe('PRESETS', () => {
  it('keys match preset ids', () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      expect(preset.id).toBe(key)
    }
  })

  it('every preset references slots 0..slotCount-1 exactly once', () => {
    for (const preset of Object.values(PRESETS) as LayoutPreset[]) {
      const slots = collectSlots(preset.root).sort((a, b) => a - b)
      const expected = Array.from({ length: preset.slotCount }, (_, i) => i)
      expect(slots).toEqual(expected)
    }
  })

  it('every preset has a non-empty label and icon', () => {
    for (const preset of Object.values(PRESETS) as LayoutPreset[]) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.icon.length).toBeGreaterThan(0)
    }
  })
})

describe('getPreset', () => {
  it('returns the preset for a known id', () => {
    expect(getPreset('3C').slotCount).toBe(3)
  })

  it('throws for unknown id', () => {
    // @ts-expect-error invalid id
    expect(() => getPreset('99X')).toThrow()
  })
})
