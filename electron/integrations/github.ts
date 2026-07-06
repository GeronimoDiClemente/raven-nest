// Adapter real de GitHub (plan Hito 2+ Task G). Implementa ServerPanelAdapter
// (electron/integration-panels.ts) contra la API REST de GitHub, usando el
// token OAuth ya persistido en pluginCreds('github') por el flujo de Connect
// existente (deps.getToken('github')).
//
// itemId de los refs codifica kind+repo+número para no necesitar estado
// entre fetchSections/fetchDetail: `issue:owner/repo:123` | `pr:owner/repo:123`.
import { readFileSync, statSync } from 'fs'
import { isAbsolute, join } from 'path'
import type {
  ServerPanelAdapter, PanelAdapterDeps, WorktreeContext, ItemRef, Section, SectionItem,
  DetailModel, DetailBlock, PanelAction, ComposeBody,
} from '../integration-panels'
import { NotConnectedError } from '../integration-panels'

const API_BASE = 'https://api.github.com'

type ItemKind = 'issue' | 'pr'

interface ParsedItemId {
  kind: ItemKind
  owner: string
  repo: string
  number: number
}

interface GitHubUser {
  login: string
}

interface GitHubLabel {
  name: string
}

interface GitHubIssue {
  number: number
  title: string
  body: string | null
  state: string
  user: GitHubUser | null
  assignee: GitHubUser | null
  assignees: GitHubUser[] | null
  labels: (GitHubLabel | string)[]
  pull_request?: unknown
  repository?: { full_name: string }
  repository_url?: string
}

interface GitHubPull {
  number: number
  title: string
  body: string | null
  state: string
  merged_at: string | null
  user: GitHubUser | null
  assignee: GitHubUser | null
  assignees: GitHubUser[] | null
  labels: (GitHubLabel | string)[]
  head: { ref: string }
}

interface GitHubComment {
  user: GitHubUser | null
  body: string | null
  created_at: string
}

// --- Resolución de owner/repo desde el remote git (sin execSync, para poder
// mockear `getRemoteUrl` en tests). Lee `.git/config` directamente; si
// `.git` es un archivo (worktree linked), sigue el `gitdir:` y el
// `commondir` hasta el config real del repo principal. ---
export function getRemoteUrl(repoPath: string): string | null {
  try {
    const dotGit = join(repoPath, '.git')
    const stat = statSync(dotGit)
    let gitDir = dotGit
    if (!stat.isDirectory()) {
      const content = readFileSync(dotGit, 'utf8')
      const match = content.match(/^gitdir:\s*(.+)$/m)
      if (!match) return null
      let linkedDir = match[1].trim()
      if (!isAbsolute(linkedDir)) linkedDir = join(repoPath, linkedDir)
      try {
        const commondir = readFileSync(join(linkedDir, 'commondir'), 'utf8').trim()
        gitDir = isAbsolute(commondir) ? commondir : join(linkedDir, commondir)
      } catch {
        gitDir = linkedDir
      }
    }
    const config = readFileSync(join(gitDir, 'config'), 'utf8')
    return parseOriginUrlFromConfig(config)
  } catch {
    return null
  }
}

function parseOriginUrlFromConfig(config: string): string | null {
  let inOrigin = false
  for (const raw of config.split('\n')) {
    const line = raw.trim()
    if (/^\[remote "origin"\]/i.test(line)) { inOrigin = true; continue }
    if (/^\[/.test(line)) { inOrigin = false; continue }
    if (inOrigin) {
      const m = line.match(/^url\s*=\s*(.+)$/)
      if (m) return m[1].trim()
    }
  }
  return null
}

function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  // https://github.com/owner/repo(.git) | git@github.com:owner/repo(.git) | ssh://git@github.com/owner/repo(.git)
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  ]
  for (const re of patterns) {
    const m = remoteUrl.match(re)
    if (m) return { owner: m[1], repo: m[2] }
  }
  return null
}

function repoShortName(fullName: string): string {
  const parts = fullName.split('/')
  return parts[parts.length - 1] ?? fullName
}

function issueRepoFullName(issue: GitHubIssue): string {
  if (issue.repository?.full_name) return issue.repository.full_name
  if (issue.repository_url) return issue.repository_url.replace(`${API_BASE}/repos/`, '')
  return 'unknown/unknown'
}

function itemId(kind: ItemKind, owner: string, repo: string, number: number): string {
  return `${kind}:${owner}/${repo}:${number}`
}

function parseItemId(id: string): ParsedItemId {
  const [kind, ownerRepo, numberStr] = id.split(':')
  const [owner, repo] = (ownerRepo ?? '').split('/')
  if ((kind !== 'issue' && kind !== 'pr') || !owner || !repo || !numberStr) {
    throw new Error(`Malformed GitHub item id "${id}"`)
  }
  return { kind, owner, repo, number: Number(numberStr) }
}

function labelNames(labels: (GitHubLabel | string)[]): string {
  return labels.map((l) => (typeof l === 'string' ? l : l.name)).join(', ')
}

function assigneeNames(issueOrPr: { assignee: GitHubUser | null; assignees: GitHubUser[] | null }): string {
  const names = (issueOrPr.assignees ?? []).map((a) => a.login)
  if (names.length > 0) return names.join(', ')
  return issueOrPr.assignee?.login ?? '—'
}

// Tiempo relativo simple (sin dependencias) para los comentarios del detail.
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.round(diffHour / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  const diffMonth = Math.round(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}mo ago`
  return `${Math.round(diffMonth / 12)}y ago`
}

export function createGitHubServerAdapter(
  deps: PanelAdapterDeps,
  resolveRemoteUrl: (repoPath: string) => string | null = getRemoteUrl,
): ServerPanelAdapter {
  async function ghRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = deps.getToken('github')
    if (!token) throw new NotConnectedError()
    const res = await deps.fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        ...(init.headers ?? {}),
      },
    })
    if (res.status === 401) throw new NotConnectedError()
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub API error ${res.status}${body ? `: ${body}` : ''}`)
    }
    if (res.status === 204) return null as T
    return res.json() as Promise<T>
  }

  function ownerRepoFromCtx(ctx: WorktreeContext): { owner: string; repo: string } | null {
    if (!ctx.repoPath) return null
    const remoteUrl = resolveRemoteUrl(ctx.repoPath)
    return remoteUrl ? parseOwnerRepo(remoteUrl) : null
  }

  return {
    async fetchSections(ctx: WorktreeContext): Promise<Section[]> {
      const sections: Section[] = []

      const assigned = await ghRequest<GitHubIssue[]>('/issues?filter=assigned&state=open')
      const assignedItems: SectionItem[] = assigned
        .filter((issue) => !issue.pull_request)
        .map((issue) => {
          const fullName = issueRepoFullName(issue)
          const [owner, repo] = fullName.split('/')
          return {
            id: itemId('issue', owner, repo, issue.number),
            title: issue.title,
            subtitle: repoShortName(fullName),
            accent: `#${issue.number}`,
          }
        })
      sections.push({ id: 'assigned', label: 'Assigned to me', items: assignedItems })

      const ownerRepo = ownerRepoFromCtx(ctx)
      if (ownerRepo) {
        const { owner, repo } = ownerRepo

        const prs = await ghRequest<GitHubPull[]>(`/repos/${owner}/${repo}/pulls?state=open`)
        sections.push({
          id: 'prs',
          label: 'Open PRs',
          items: prs.map((pr) => ({
            id: itemId('pr', owner, repo, pr.number),
            title: pr.title,
            subtitle: pr.user?.login ? `by ${pr.user.login}` : undefined,
            accent: `#${pr.number}`,
          })),
        })

        const issues = await ghRequest<GitHubIssue[]>(`/repos/${owner}/${repo}/issues?state=open&per_page=10`)
        sections.push({
          id: 'issues',
          label: 'Recent issues',
          items: issues
            .filter((issue) => !issue.pull_request)
            .map((issue) => ({
              id: itemId('issue', owner, repo, issue.number),
              title: issue.title,
              subtitle: issue.user?.login ? `by ${issue.user.login}` : undefined,
              accent: `#${issue.number}`,
            })),
        })
      }

      return sections
    },

    async fetchDetail(ref: ItemRef): Promise<DetailModel> {
      const { kind, owner, repo, number } = parseItemId(ref.itemId)

      let title: string
      let body: string | null
      let status: string
      let author: string
      let assignee: string
      let labels: string

      if (kind === 'pr') {
        const pr = await ghRequest<GitHubPull>(`/repos/${owner}/${repo}/pulls/${number}`)
        title = pr.title
        body = pr.body
        status = pr.merged_at ? 'merged' : pr.state
        author = pr.user?.login ?? '—'
        assignee = assigneeNames(pr)
        labels = labelNames(pr.labels)
      } else {
        const issue = await ghRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues/${number}`)
        title = issue.title
        body = issue.body
        status = issue.state
        author = issue.user?.login ?? '—'
        assignee = assigneeNames(issue)
        labels = labelNames(issue.labels)
      }

      const comments = await ghRequest<GitHubComment[]>(`/repos/${owner}/${repo}/issues/${number}/comments`)
      const lastComments = comments.slice(-10)

      const blocks: DetailBlock[] = [
        { kind: 'text', text: body ?? '' },
        ...lastComments.map((c): DetailBlock => ({
          kind: 'comment',
          author: c.user?.login ?? '—',
          when: relativeTime(c.created_at),
          text: c.body ?? '',
        })),
      ]

      return {
        ref,
        title,
        key: `#${number}`,
        status,
        meta: [
          { label: 'Author', value: author },
          { label: 'Assignee', value: assignee },
          { label: 'Labels', value: labels || '—' },
        ],
        blocks,
      }
    },

    async resolveWorktreeEntity(ctx: WorktreeContext): Promise<ItemRef | null> {
      if (!ctx.branch) return null
      const ownerRepo = ownerRepoFromCtx(ctx)
      if (!ownerRepo) return null
      const { owner, repo } = ownerRepo

      const prs = await ghRequest<GitHubPull[]>(
        `/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(ctx.branch)}&state=all`,
      )
      const matchingPr = prs.find((pr) => pr.head.ref === ctx.branch) ?? prs[0]
      if (matchingPr) {
        return { sectionId: 'prs', itemId: itemId('pr', owner, repo, matchingPr.number) }
      }

      const numberMatch = ctx.branch.match(/(\d+)/)
      if (numberMatch) {
        return { sectionId: 'issues', itemId: itemId('issue', owner, repo, Number(numberMatch[1])) }
      }

      return null
    },

    actions(detail: DetailModel): PanelAction[] {
      const { kind } = parseItemId(detail.ref.itemId)
      if (kind === 'pr') return [] // merge queda fuera de alcance (plan Task G)
      return detail.status === 'open'
        ? [{ id: 'close', label: 'Close issue', kind: 'primary' }]
        : [{ id: 'reopen', label: 'Reopen', kind: 'secondary' }]
    },

    async runAction(actionId: string, ref: ItemRef): Promise<void> {
      const { owner, repo, number } = parseItemId(ref.itemId)
      const state = actionId === 'close' ? 'closed' : actionId === 'reopen' ? 'open' : null
      if (!state) throw new Error(`Unknown GitHub action "${actionId}"`)
      await ghRequest(`/repos/${owner}/${repo}/issues/${number}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      })
    },

    async compose(target: ItemRef, body: ComposeBody): Promise<void> {
      const { owner, repo, number } = parseItemId(target.itemId)
      const text = body.terminalOutput ? `${body.text}\n\`\`\`\n${body.terminalOutput}\n\`\`\`` : body.text
      await ghRequest(`/repos/${owner}/${repo}/issues/${number}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      })
    },
  }
}
