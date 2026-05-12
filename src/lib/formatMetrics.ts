export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let idx = 0
  let val = bytes
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx += 1
  }
  const decimals = val < 10 ? 2 : val < 100 ? 1 : 0
  return `${val.toFixed(decimals)} ${units[idx]}`
}

export function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct < 0) return '0.0%'
  return `${pct.toFixed(1)}%`
}

export function diskLabel(bytes: number | null): string {
  return bytes === null ? '—' : formatBytes(bytes)
}
