import type { LayoutId } from '../types'

export function defaultLayoutFor(n: number): LayoutId {
  if (n <= 1) return '1'
  if (n === 2) return '2V'
  if (n === 3) return '3C'
  if (n === 4) return '4Q'
  if (n === 5) return '5T'
  if (n === 6) return '6G'
  if (n === 7) return '7T'
  if (n === 8) return '8G'
  if (n === 9) return '9G'
  if (n === 10) return '10G'
  if (n === 11) return '11G'
  return '12G'  // N >= 12; the engine caps adds at MAX_PANES=12
}

export function alternativesFor(n: number): LayoutId[] {
  if (n === 2) return ['2V', '2H']
  if (n === 3) return ['3C', '3M', '3T']
  if (n === 4) return ['4Q', '4M', '4T']
  if (n === 5) return ['5T', '5M', '5B']
  if (n === 6) return ['6G', '6M', '6C']
  if (n === 7) return ['7T', '7M', '7B']
  if (n === 8) return ['8G', '8M', '8B']
  if (n === 9) return ['9G', '9M', '9T']
  if (n === 10) return ['10G', '10M', '10B']
  if (n === 11) return ['11G', '11M', '11B']
  if (n === 12) return ['12G', '12M', '12C']
  return [defaultLayoutFor(n)]
}

const LEGACY_MAP: Record<string, LayoutId> = {
  '1x1': '1',
  '1x2': '2V',
  '2x1': '2H',
  '1x3': '3C',
  '2x2': '4Q',
  '2x3': '6G',
  '3x2': '6G',
  '3x3': '9G',
}

export function mapLegacyToPreset(rows: number, cols: number, n: number): LayoutId {
  const hit = LEGACY_MAP[`${rows}x${cols}`]
  if (hit) return hit
  return defaultLayoutFor(n)
}
