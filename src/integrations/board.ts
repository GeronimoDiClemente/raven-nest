export type Scope = { kind: 'org'; org: string } | { kind: 'personal' }

/** Org vs personal from a "owner/repo" full name. `null` repo → personal. */
export function deriveScope(repoFullName: string | null, personalLogin: string): Scope {
  if (!repoFullName) return { kind: 'personal' }
  const owner = repoFullName.split('/')[0]
  if (!owner || owner.toLowerCase() === personalLogin.toLowerCase()) {
    return { kind: 'personal' }
  }
  return { kind: 'org', org: owner }
}
