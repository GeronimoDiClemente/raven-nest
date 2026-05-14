import type { LayoutId } from '../types'

export function defaultLayoutFor(n: number): LayoutId {
  if (n <= 1) return '1'
  if (n === 2) return '2V'
  if (n === 3) return '3C'
  if (n === 4) return '4Q'
  if (n === 5) return '5T'
  if (n === 6) return '6G'
  return '9G'
}

export function alternativesFor(n: number): LayoutId[] {
  if (n === 2) return ['2V', '2H']
  if (n === 3) return ['3C', '3M', '3T']
  if (n === 4) return ['4Q', '4M']
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
