# Team Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una sección "Stats" en `TeamsWorkspace` que muestre actividad de la última semana por developer (commits, PRs, quién está online ahora), usando datos que ya fluyen por el app.

**Architecture:** Un nuevo hook `useTeamStats` fetcha los eventos de GitHub (mismo endpoint que usa `ActivityFeed`) y los agrega por `actor.login`. Un componente `TeamStats` renderiza overview cards + tabla de developers. `TeamsWorkspace` recibe el nuevo tab `'stats'` con mínimos cambios: una línea en el tipo, una entrada en `NAV_ITEMS` y un bloque de render.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, Playwright (e2e Electron), GitHub REST API (`/repos/:owner/:repo/events`), Supabase Realtime (presence ya existente).

## Global Constraints

- TypeScript estricto — no `any`
- Tests con Vitest (`import { describe, it, expect, vi } from 'vitest'`)
- Estilos: inline styles o clases ya existentes en `global.css` para los nuevos elementos simples; agregar clases nuevas al final del archivo para layout
- No crear archivos CSS separados — todo en `src/styles/global.css`
- `per_page=100` en el fetch de eventos (el ActivityFeed usa 10; necesitamos más para cubrir la semana)
- Correr tests con `npm test` (alias de `vitest run`)

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/hooks/useTeamStats.ts` | Crear | Fetch + agregación de eventos GitHub por developer |
| `src/__tests__/hooks/useTeamStats.test.ts` | Crear | Tests unitarios de la lógica de agregación |
| `src/components/TeamStats.tsx` | Crear | UI: overview cards + tabla de developers |
| `src/__tests__/components/TeamStats.test.tsx` | Crear | Tests del componente |
| `src/styles/global.css` | Modificar | Agregar clases `.ts-*` al final del archivo |
| `src/components/TeamsWorkspace.tsx` | Modificar | Agregar `'stats'` al tipo, nav item y render |
| `e2e/team-stats.spec.ts` | Crear | Smoke test Playwright: Teams abre sin crash con el nuevo código |

---

## Setup: crear rama de feature

Antes de cualquier tarea, crear la rama:

```bash
git checkout -b feat/team-stats
```

---

## Task 1: Hook `useTeamStats` — fetch y agregación

**Files:**
- Create: `src/hooks/useTeamStats.ts`
- Create: `src/__tests__/hooks/useTeamStats.test.ts`

**Interfaces:**
- Produce: `aggregateEvents(events: GitHubEvent[]): DeveloperStats[]` (exportada para testear)
- Produce: `useTeamStats(repos, githubToken): { stats: TeamStatsData; loading: boolean; error: string | null }`

---

- [ ] **Step 1: Escribir el test de agregación**

Crear `src/__tests__/hooks/useTeamStats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateEvents } from '../../hooks/useTeamStats'

const NOW = new Date().toISOString()
const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() // 8 días atrás

const makeEvent = (
  id: string,
  login: string,
  type: string,
  created_at: string,
  payload: object = {}
) => ({
  id,
  type,
  actor: { login, avatar_url: `https://avatars.githubusercontent.com/u/1?v=4` },
  created_at,
  payload,
})

describe('aggregateEvents', () => {
  it('cuenta commits de PushEvent de esta semana', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'fix' }, { sha: 'b', message: 'feat' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].login).toBe('alice')
    expect(result[0].commits).toBe(2)
  })

  it('ignora eventos de hace más de 7 días', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', OLD, { commits: [{ sha: 'a', message: 'old' }] }),
    ]
    expect(aggregateEvents(events)).toHaveLength(0)
  })

  it('cuenta PRs abiertos y mergeados por separado', () => {
    const events = [
      makeEvent('1', 'bob', 'PullRequestEvent', NOW, { action: 'opened' }),
      makeEvent('2', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: true } }),
      makeEvent('3', 'bob', 'PullRequestEvent', NOW, { action: 'closed', pull_request: { merged: false } }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].prsOpened).toBe(1)
    expect(result[0].prsMerged).toBe(1)
  })

  it('cuenta issues cerrados', () => {
    const events = [
      makeEvent('1', 'carol', 'IssuesEvent', NOW, { action: 'closed' }),
      makeEvent('2', 'carol', 'IssuesEvent', NOW, { action: 'opened' }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].issuesClosed).toBe(1)
  })

  it('agrupa múltiples eventos del mismo developer', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0].commits).toBe(3)
  })

  it('ordena por commits descendente', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('2', 'bob', 'PushEvent', NOW, { commits: [{ sha: 'b', message: 'y' }, { sha: 'c', message: 'z' }, { sha: 'd', message: 'w' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].login).toBe('bob')
    expect(result[1].login).toBe('alice')
  })

  it('deduplica eventos con el mismo id', () => {
    const events = [
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
      makeEvent('1', 'alice', 'PushEvent', NOW, { commits: [{ sha: 'a', message: 'x' }] }),
    ]
    const result = aggregateEvents(events)
    expect(result[0].commits).toBe(1)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test -- useTeamStats
```

Resultado esperado: `Error: Failed to resolve import "../../hooks/useTeamStats"`

- [ ] **Step 3: Implementar `useTeamStats.ts`**

Crear `src/hooks/useTeamStats.ts`:

```typescript
import { useState, useEffect, useMemo } from 'react'

export interface DeveloperStats {
  login: string
  avatarUrl: string
  commits: number
  prsOpened: number
  prsMerged: number
  issuesClosed: number
  lastEventAt: string | null
}

export interface TeamStatsData {
  developers: DeveloperStats[]
  totalCommits: number
  totalPrsMerged: number
  topDeveloper: DeveloperStats | null
}

interface GitHubEvent {
  id: string
  type: string
  actor: { login: string; avatar_url: string }
  created_at: string
  payload: {
    action?: string
    commits?: { sha: string; message: string }[]
    pull_request?: { merged?: boolean }
  }
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

function isThisWeek(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < ONE_WEEK_MS
}

export function aggregateEvents(events: GitHubEvent[]): DeveloperStats[] {
  const map = new Map<string, DeveloperStats>()
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    if (!isThisWeek(event.created_at)) continue

    const { login, avatar_url } = event.actor
    if (!map.has(login)) {
      map.set(login, {
        login,
        avatarUrl: avatar_url,
        commits: 0,
        prsOpened: 0,
        prsMerged: 0,
        issuesClosed: 0,
        lastEventAt: null,
      })
    }
    const dev = map.get(login)!

    if (!dev.lastEventAt || event.created_at > dev.lastEventAt) {
      dev.lastEventAt = event.created_at
    }

    if (event.type === 'PushEvent') {
      dev.commits += event.payload.commits?.length ?? 0
    } else if (event.type === 'PullRequestEvent') {
      if (event.payload.action === 'opened') dev.prsOpened++
      if (event.payload.action === 'closed' && event.payload.pull_request?.merged) dev.prsMerged++
    } else if (event.type === 'IssuesEvent' && event.payload.action === 'closed') {
      dev.issuesClosed++
    }
  }

  return Array.from(map.values()).sort((a, b) => b.commits - a.commits)
}

export function useTeamStats(
  repos: Array<{ repo_full_name: string }>,
  githubToken: string | null
): { stats: TeamStatsData; loading: boolean; error: string | null } {
  const [events, setEvents] = useState<GitHubEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoNames = useMemo(
    () => repos.map(r => r.repo_full_name).join(','),
    [repos]
  )

  useEffect(() => {
    if (!githubToken || !repoNames) return
    const repoList = repoNames.split(',').filter(Boolean)
    let alive = true
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        const results = await Promise.allSettled(
          repoList.map(name =>
            fetch(`https://api.github.com/repos/${name}/events?per_page=100`, {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github.v3+json',
              },
            }).then(res => (res.ok ? (res.json() as Promise<GitHubEvent[]>) : ([] as GitHubEvent[])))
          )
        )
        const all: GitHubEvent[] = []
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(...r.value)
        }
        if (alive) setEvents(all)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load stats')
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()
    return () => { alive = false }
  }, [repoNames, githubToken])

  const developers = useMemo(() => aggregateEvents(events), [events])
  const totalCommits = developers.reduce((s, d) => s + d.commits, 0)
  const totalPrsMerged = developers.reduce((s, d) => s + d.prsMerged, 0)
  const topDeveloper = developers[0] ?? null

  return {
    stats: { developers, totalCommits, totalPrsMerged, topDeveloper },
    loading,
    error,
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npm test -- useTeamStats
```

Resultado esperado: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTeamStats.ts src/__tests__/hooks/useTeamStats.test.ts
git commit -m "feat: add useTeamStats hook with GitHub event aggregation"
```

---

## Task 2: Componente `TeamStats` — UI

**Files:**
- Create: `src/components/TeamStats.tsx`
- Create: `src/__tests__/components/TeamStats.test.tsx`
- Modify: `src/styles/global.css` — agregar clases `.ts-*` al final

**Interfaces:**
- Consume: `useTeamStats(repos, githubToken)` → `{ stats: TeamStatsData, loading, error }`
- Consume: `presence: Record<string, PresenceState>` (de `useTeamPresence`)
- Props:
  ```typescript
  interface TeamStatsProps {
    repos: Array<{ repo_full_name: string }>
    githubToken: string | null
    presence: Record<string, PresenceState>
  }
  ```

---

- [ ] **Step 1: Escribir el test del componente**

Crear `src/__tests__/components/TeamStats.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeamStats from '../../components/TeamStats'

vi.mock('../../hooks/useTeamStats', () => ({
  useTeamStats: () => ({
    stats: {
      developers: [
        {
          login: 'alice',
          avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
          commits: 12,
          prsOpened: 2,
          prsMerged: 1,
          issuesClosed: 3,
          lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        },
        {
          login: 'bob',
          avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
          commits: 4,
          prsOpened: 0,
          prsMerged: 0,
          issuesClosed: 0,
          lastEventAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
      ],
      totalCommits: 16,
      totalPrsMerged: 1,
      topDeveloper: {
        login: 'alice',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        commits: 12,
        prsOpened: 2,
        prsMerged: 1,
        issuesClosed: 3,
        lastEventAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    },
    loading: false,
    error: null,
  }),
}))

const presence = {
  'user-alice': { userId: 'user-alice', displayName: 'alice@co.com', repo: 'org/repo', branch: 'main', lastSeen: new Date().toISOString() },
}

const defaultProps = {
  repos: [{ repo_full_name: 'org/repo' }],
  githubToken: 'token',
  presence,
}

describe('TeamStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el conteo de commits totales en las cards de overview', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('16')).toBeTruthy()
  })

  it('muestra el developer más activo', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('alice')).toBeTruthy()
  })

  it('muestra el conteo de developers online desde presence', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('muestra la tabla con ambos developers', () => {
    render(<TeamStats {...defaultProps} />)
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('bob')).toBeTruthy()
  })

  it('muestra mensaje de conectar GitHub cuando no hay token', () => {
    render(<TeamStats {...defaultProps} githubToken={null} />)
    expect(screen.getByText(/connect your github/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
npm test -- "TeamStats.test"
```

Resultado esperado: `Error: Failed to resolve import "../../components/TeamStats"`

- [ ] **Step 3: Agregar clases CSS al final de `src/styles/global.css`**

Agregar al final del archivo:

```css
/* ── Team Stats ──────────────────────────────────────────── */
.ts-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
  height: 100%;
  overflow-y: auto;
}

.ts-overview-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.ts-card {
  background: #ffffff08;
  border: 1px solid #ffffff12;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ts-card-label {
  font-size: 10px;
  color: #ffffff55;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ts-card-value {
  font-size: 22px;
  font-weight: 600;
  color: #fff;
  line-height: 1;
}

.ts-card-sub {
  font-size: 11px;
  color: #ffffff66;
}

.ts-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #ffffff55;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}

.ts-table-wrap {
  overflow-x: auto;
}

.ts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ts-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 500;
  color: #ffffff44;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 8px 8px;
  white-space: nowrap;
}

.ts-table th:first-child { padding-left: 0; }

.ts-table td {
  padding: 6px 8px;
  color: #ffffffcc;
  border-top: 1px solid #ffffff08;
  vertical-align: middle;
}

.ts-table td:first-child { padding-left: 0; }

.ts-table tr:hover td { background: #ffffff05; }

.ts-dev-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ts-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ts-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ts-status-dot.online  { background: #22c55e; }
.ts-status-dot.offline { background: #ffffff22; }

.ts-num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.ts-muted { color: #ffffff44; }

.ts-empty {
  padding: 40px 0;
  text-align: center;
  color: #ffffff44;
  font-size: 12px;
}
```

- [ ] **Step 4: Implementar `TeamStats.tsx`**

Crear `src/components/TeamStats.tsx`:

```typescript
import { useTeamStats } from '../hooks/useTeamStats'
import type { PresenceState } from '../hooks/useTeamPresence'

interface TeamStatsProps {
  repos: Array<{ repo_full_name: string }>
  githubToken: string | null
  presence: Record<string, PresenceState>
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function TeamStats({ repos, githubToken, presence }: TeamStatsProps) {
  const { stats, loading, error } = useTeamStats(repos, githubToken)
  const onlineCount = Object.keys(presence).length
  const onlineLogins = new Set(
    Object.values(presence).map(p => p.displayName.split('@')[0].toLowerCase())
  )

  if (!githubToken) {
    return (
      <div className="ts-container">
        <div className="ts-empty">Connect your GitHub account to see team stats</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="ts-container">
        <div className="ts-empty">Loading stats…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ts-container">
        <div className="ts-empty">{error}</div>
      </div>
    )
  }

  const { developers, totalCommits, totalPrsMerged, topDeveloper } = stats

  return (
    <div className="ts-container">
      {/* Overview cards */}
      <div>
        <div className="ts-section-title">This week</div>
        <div className="ts-overview-row">
          <div className="ts-card">
            <span className="ts-card-label">Online now</span>
            <span className="ts-card-value">{onlineCount}</span>
            <span className="ts-card-sub">developers active</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Commits</span>
            <span className="ts-card-value">{totalCommits}</span>
            <span className="ts-card-sub">across all repos</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">PRs merged</span>
            <span className="ts-card-value">{totalPrsMerged}</span>
            <span className="ts-card-sub">this week</span>
          </div>
          <div className="ts-card">
            <span className="ts-card-label">Top dev</span>
            <span className="ts-card-value" style={{ fontSize: 14, paddingTop: 4 }}>
              {topDeveloper ? `@${topDeveloper.login}` : '—'}
            </span>
            <span className="ts-card-sub">
              {topDeveloper ? `${topDeveloper.commits} commits` : 'no activity'}
            </span>
          </div>
        </div>
      </div>

      {/* Developer table */}
      <div>
        <div className="ts-section-title">Developers</div>
        {developers.length === 0 ? (
          <div className="ts-empty">No activity in the last 7 days</div>
        ) : (
          <div className="ts-table-wrap">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Developer</th>
                  <th style={{ textAlign: 'right' }}>Commits</th>
                  <th style={{ textAlign: 'right' }}>PRs</th>
                  <th style={{ textAlign: 'right' }}>Issues</th>
                  <th style={{ textAlign: 'right' }}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {developers.map(dev => {
                  const isOnline = onlineLogins.has(dev.login.toLowerCase())
                  return (
                    <tr key={dev.login}>
                      <td>
                        <div className="ts-dev-cell">
                          <span className={`ts-status-dot ${isOnline ? 'online' : 'offline'}`} />
                          <img
                            className="ts-avatar"
                            src={dev.avatarUrl}
                            alt={dev.login}
                          />
                          <span>{dev.login}</span>
                        </div>
                      </td>
                      <td className="ts-num">{dev.commits || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.prsOpened + dev.prsMerged || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num">{dev.issuesClosed || <span className="ts-muted">—</span>}</td>
                      <td className="ts-num ts-muted">{timeAgo(dev.lastEventAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npm test -- "TeamStats.test"
```

Resultado esperado: `5 passed`

- [ ] **Step 6: Commit**

```bash
git add src/components/TeamStats.tsx src/__tests__/components/TeamStats.test.tsx src/styles/global.css
git commit -m "feat: add TeamStats component with overview cards and developer table"
```

---

## Task 3: Integrar en `TeamsWorkspace`

**Files:**
- Modify: `src/components/TeamsWorkspace.tsx`

**Interfaces:**
- Consume: `TeamStats` (default export de `src/components/TeamStats.tsx`)
- Consume: Props ya disponibles en `TeamsWorkspace`: `repos`, `githubToken`, `presence`

---

- [ ] **Step 1: Agregar `'stats'` al tipo `WorkspaceSection`**

En `src/components/TeamsWorkspace.tsx`, línea 44, cambiar:

```typescript
// Antes:
type WorkspaceSection = 'activity' | 'chat' | 'repos' | 'issues' | 'members' | 'snippets' | 'workspaces' | 'mcp' | 'pendings'

// Después:
type WorkspaceSection = 'activity' | 'chat' | 'repos' | 'issues' | 'members' | 'snippets' | 'workspaces' | 'mcp' | 'pendings' | 'stats'
```

- [ ] **Step 2: Agregar el import de `TeamStats`**

Después de la línea que importa `TeamJoinCodePanel` (aprox. línea 32), agregar:

```typescript
import TeamStats from './TeamStats'
```

- [ ] **Step 3: Agregar el nav item de Stats en `NAV_ITEMS`**

Agregar después del item `'members'` (después de la línea 364 aprox), antes del item `'snippets'`:

```typescript
{
  id: 'stats',
  label: 'Stats',
  icon: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="9" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="6" y="5" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
},
```

- [ ] **Step 4: Agregar el bloque de render para la sección `'stats'`**

Buscar el último bloque de sección antes del cierre `</ErrorBoundary>` (aprox. línea 1255, sección `'mcp'`). Después de ese bloque, agregar:

```typescript
{!creatingTeam && section === 'stats' && (
  <TeamStats
    repos={repos.map(r => ({ repo_full_name: r.repo_full_name }))}
    githubToken={githubToken}
    presence={presence}
  />
)}
```

- [ ] **Step 5: Correr todos los tests**

```bash
npm test
```

Resultado esperado: todos los tests previos siguen pasando + los nuevos.

- [ ] **Step 6: Verificar TypeScript**

```bash
npm run typecheck 2>/dev/null || npx tsc --noEmit
```

Resultado esperado: sin errores.

- [ ] **Step 7: Commit final**

```bash
git add src/components/TeamsWorkspace.tsx
git commit -m "feat: add Stats tab to TeamsWorkspace for team analytics"
```

---

## Task 4: Playwright smoke test

**Files:**
- Create: `e2e/team-stats.spec.ts`

El test lanza la app con auth bypassed y verifica que TeamsWorkspace abre sin crash con el nuevo código integrado. El test de Stats en sí (con equipo real, token GitHub real) lo hace Gero en Mac/Linux con su cuenta.

**Nota:** Playwright requiere que el app esté buildeada. El workflow de CI ya lo hace antes de correr e2e. Localmente: `npm run build` antes de `npm run test:e2e`.

---

- [ ] **Step 1: Crear `e2e/team-stats.spec.ts`**

```typescript
import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

test('TeamsWorkspace opens without crash after Stats tab integration', async () => {
  const h = await launchHarness({ withRepo: false })

  // Click the Teams button in the sidebar
  await h.page.locator('.sidebar-item-team').click()

  // TeamsWorkspace mounts — either the empty state (no team) or the full workspace
  await expect(h.page.locator('.teams-workspace')).toBeVisible({ timeout: 10_000 })

  // No JS error overlay should be visible
  await expect(h.page.locator('.error-boundary-fallback')).not.toBeVisible()

  await teardown(h)
})
```

- [ ] **Step 2: Commit**

```bash
git add e2e/team-stats.spec.ts
git commit -m "test: add Playwright smoke test for Stats tab in TeamsWorkspace"
```

---

## Task 5: Crear el PR

- [ ] **Step 1: Push de la rama**

```bash
git push origin feat/team-stats
```

- [ ] **Step 2: Crear el PR**

```bash
gh pr create \
  --title "feat: Team Stats tab — activity dashboard for team leaders" \
  --body "$(cat <<'EOF'
## Qué hace

Agrega una nueva sección **Stats** al `TeamsWorkspace` que muestra métricas de actividad de la última semana por developer, usando datos que ya fluyen por el app (GitHub Events API + Supabase Presence). Sin migraciones de base de datos.

## Pantallas

- **Overview cards:** devs online ahora, commits totales, PRs mergeados, developer más activo
- **Tabla de developers:** avatar, estado online/offline, commits, PRs, issues cerrados, última actividad — ordenado por commits desc

## Archivos modificados

- `src/hooks/useTeamStats.ts` — nuevo hook, agrega eventos por `actor.login`
- `src/components/TeamStats.tsx` — nuevo componente
- `src/styles/global.css` — clases `.ts-*` al final del archivo
- `src/components/TeamsWorkspace.tsx` — +1 línea en el tipo, +1 nav item, +1 bloque de render
- `e2e/team-stats.spec.ts` — smoke test Playwright

## Tests

- 7 unit tests en `useTeamStats.test.ts` (aggregation logic)
- 5 unit tests en `TeamStats.test.tsx` (component render)
- 1 Playwright smoke test (Teams abre sin crash)

## Para el reviewer (Gero)

- [ ] Verificar en Mac y Linux que el tab Stats aparece correctamente en Teams
- [ ] Con GitHub conectado y repos de equipo, confirmar que los datos de la semana cargan
- [ ] Security: el fetch usa el token OAuth ya existente en el hook `useGitHub`, mismo que usa `ActivityFeed`
- [ ] El e2e requiere `npm run build` previo (igual que los otros specs)
EOF
)"
```

- [ ] **Step 3: Copiar la URL del PR y compartirla**
