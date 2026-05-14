export function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i === j) return arr
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr
  const next = [...arr]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
