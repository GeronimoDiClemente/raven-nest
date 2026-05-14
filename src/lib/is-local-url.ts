const LOCAL_HOST_RE = /^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i
const LOCAL_BARE_RE = /^localhost(:\d+)?(\/|$)?$/i

export function isLocalUrl(url: string): boolean {
  if (!url) return false
  if (LOCAL_BARE_RE.test(url)) return true
  return LOCAL_HOST_RE.test(url)
}
