// Branch name for "Work on this": <user>/<TICKET-KEY>-<slug>.
// Must ALWAYS pass the worktree:create regex (/^[a-zA-Z0-9._/\-]+$/):
// an invalid branch would break the whole button flow.
const MAX_SLUG = 40

function kebab(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents/ñ → ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function ticketBranchName(user: string, key: string, title: string): string {
  const u = kebab(user) || 'nest'
  // Separators (/, #, …) become '-' so a GitHub key "owner/repo#n" reads as
  // "owner-repo-n" instead of mashing owner+repo together. Collapse runs and
  // trim the edges so the key never contributes a dangling '-'.
  const k = key.replace(/[^a-zA-Z0-9._\-]+/g, '-').replace(/^-+|-+$/g, '') || 'task'
  const slug = kebab(title).slice(0, MAX_SLUG).replace(/-+$/g, '')
  return slug ? `${u}/${k}-${slug}` : `${u}/${k}`
}
