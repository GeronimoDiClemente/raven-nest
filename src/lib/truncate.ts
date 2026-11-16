// Truncar nombres o strings untrusted a una longitud máxima con ellipsis.
export function truncateWithEllipsis(text: string, maxLength: number = 40): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '…'
}
