# H3 Ticket Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor 1 de la spec de integraciones v3 — "Mis tickets" (Jira + Linear + GitHub Issues) → botón *Work on this* → worktree con el ID en la rama + contexto del ticket → estado del ticket inferido de git.

**Architecture:** Un `TicketProvider` por plataforma vive en el main process (tokens nunca salen de main, mismo patrón que `ServerPanelAdapter` del hito 2). Un registry (`electron/ticket-loop.ts`) expone IPC `tickets:*`. El renderer agrega la vista "My tickets" al shell de integraciones existente; *Work on this* reusa `worktree:create` + el flujo `setAddingPane({ worktreePath })` de App.tsx. El contexto del ticket se escribe como `TASK.md` en el worktree. Transiciones: *In Progress* al crear el worktree; *In Review/Done* por polling de PRs de GitHub por nombre de rama.

**Tech Stack:** TypeScript estricto, Vitest (proyecto `node` para electron/), fetch inyectado por deps (mockeable), APIs: Jira REST v3, Linear GraphQL, GitHub REST.

**Spec:** `docs/superpowers/specs/2026-07-11-integrations-task-loop-design.md`

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `electron/integrations/ticket-types.ts` | Crear | Tipos compartidos del motor (Ticket, TicketProvider, TicketState) |
| `electron/integrations/branch-name.ts` | Crear | `ticketBranchName()` puro y testeable |
| `electron/integrations/tickets-jira.ts` | Crear | Provider Jira (JQL assignee=currentUser) |
| `electron/integrations/tickets-linear.ts` | Crear | Provider Linear (GraphQL viewer.assignedIssues) |
| `electron/integrations/tickets-github.ts` | Crear | Provider GitHub Issues (search assigned) |
| `electron/ticket-loop.ts` | Crear | Registry + startWork + polling de PRs + transiciones |
| `electron/main.ts` | Modificar | Handlers IPC `tickets:*` (junto a `plugins:panel:call`, ~línea 2241) |
| `electron/preload.ts` | Modificar | Namespace `window.tickets` |
| `src/types.ts` | Modificar | Tipos del bridge `window.tickets` |
| `src/hooks/useMyTickets.ts` | Crear | Hook del renderer |
| `src/components/IntegrationPanel/MyTicketsView.tsx` | Crear | Lista + Work on this |
| `src/components/MyReposPanel.tsx` | Modificar | Montar MyTicketsView en el shell de integraciones |
| `electron/__tests__/branch-name.test.ts` | Crear | Tests del naming |
| `electron/__tests__/tickets-providers.test.ts` | Crear | Tests de los 3 providers con fetch mock |
| `electron/__tests__/ticket-loop.test.ts` | Crear | Tests de startWork/transiciones |

Regla de la spec que gobierna todo: **lista simple + una acción; NUNCA replicar el tablero.**

---

## Task A: Tipos del motor

**Files:** Create: `electron/integrations/ticket-types.ts`

- [ ] **Step 1: Crear los tipos** (sin test — solo tipos)

```typescript
// Contrato del Motor 1 (ticket loop). Providers viven en main: reciben deps
// inyectadas (token/config/fetch) igual que ServerPanelAdapter (hito 2).
import type { PanelAdapterDeps } from '../integration-panels'

export type TicketState = 'todo' | 'in_progress' | 'in_review' | 'done'

export interface Ticket {
  /** id visible tipo "PROJ-142" (Jira), "ENG-42" (Linear), "#123" (GitHub) */
  key: string
  /** id interno que el provider necesita para la API (issueId, node id, number) */
  providerId: string
  title: string
  url: string
  state: TicketState
  /** markdown: descripción + comentarios, para TASK.md */
  context: string
}

export interface TicketProvider {
  /** tickets asignados al usuario conectado, abiertos primero */
  listMyTickets(): Promise<Ticket[]>
  /** transiciona el ticket; no-op si la plataforma no tiene ese estado */
  transition(providerId: string, to: TicketState): Promise<void>
}

export type TicketProviderFactory = (deps: PanelAdapterDeps) => TicketProvider
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add electron/integrations/ticket-types.ts
git commit -m "feat(integrations): tipos del motor ticket-loop (Task A)"
```

---

## Task B: Generador de nombre de rama

**Files:**
- Create: `electron/integrations/branch-name.ts`
- Test: `electron/__tests__/branch-name.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```typescript
import { describe, it, expect } from 'vitest'
import { ticketBranchName } from '../integrations/branch-name'

describe('ticketBranchName', () => {
  it('arma user/KEY-slug en kebab', () => {
    expect(ticketBranchName('gero', 'PROJ-142', 'Fix auth bug in login'))
      .toBe('gero/PROJ-142-fix-auth-bug-in-login')
  })

  it('sanitiza chars fuera del regex de worktree:create', () => {
    // worktree:create valida /^[a-zA-Z0-9._/\-]+$/
    expect(ticketBranchName('gero', '#123', '¡Añadir ñandú & co.!'))
      .toBe('gero/123-anadir-nandu-co')
  })

  it('trunca el slug a 40 chars sin cortar palabra a la mitad del guion', () => {
    const b = ticketBranchName('gero', 'ENG-1', 'a'.repeat(80))
    expect(b.length).toBeLessThanOrEqual('gero/ENG-1-'.length + 40)
    expect(b.endsWith('-')).toBe(false)
  })

  it('usuario vacío cae a "nest"', () => {
    expect(ticketBranchName('', 'X-1', 'y')).toBe('nest/X-1-y')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run electron/__tests__/branch-name.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
// Nombre de rama para "Work on this": <user>/<TICKET-KEY>-<slug>.
// Debe pasar el regex de worktree:create (/^[a-zA-Z0-9._/\-]+$/) SIEMPRE:
// un branch inválido rompería el flujo entero del botón.
const MAX_SLUG = 40

function kebab(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tildes/ñ → ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function ticketBranchName(user: string, key: string, title: string): string {
  const u = kebab(user) || 'nest'
  const k = key.replace(/[^a-zA-Z0-9._\-]/g, '') || 'task'
  let slug = kebab(title).slice(0, MAX_SLUG).replace(/-+$/g, '')
  return slug ? `${u}/${k}-${slug}` : `${u}/${k}`
}
```

- [ ] **Step 4: Correr y ver verde**

Run: `npx vitest run electron/__tests__/branch-name.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/branch-name.ts electron/__tests__/branch-name.test.ts
git commit -m "feat(integrations): ticketBranchName con sanitizado para worktree:create (Task B)"
```

---

## Task C: Provider Jira

**Files:**
- Create: `electron/integrations/tickets-jira.ts`
- Test: `electron/__tests__/tickets-providers.test.ts` (sección Jira)

- [ ] **Step 1: Test que falla** (crear el archivo de test con la sección Jira)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createJiraTicketProvider } from '../integrations/tickets-jira'
import type { PanelAdapterDeps } from '../integration-panels'

function deps(responses: Record<string, unknown>): PanelAdapterDeps {
  return {
    getToken: () => 'tok',
    getConfig: () => ({ baseUrl: 'https://acme.atlassian.net', email: 'g@a.com' }),
    fetch: vi.fn(async (url: RequestInfo | URL) => {
      const key = Object.keys(responses).find(k => String(url).includes(k))
      if (!key) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify(responses[key]), { status: 200 })
    }) as unknown as typeof fetch,
  }
}

describe('JiraTicketProvider', () => {
  it('lista tickets asignados con estado mapeado', async () => {
    const p = createJiraTicketProvider(deps({
      '/rest/api/3/search': {
        issues: [{
          id: '10001', key: 'PROJ-142',
          fields: {
            summary: 'Fix auth', description: null,
            status: { statusCategory: { key: 'indeterminate' } },
            comment: { comments: [] },
          },
        }],
      },
    }))
    const t = await p.listMyTickets()
    expect(t[0]).toMatchObject({
      key: 'PROJ-142', providerId: '10001', title: 'Fix auth', state: 'in_progress',
      url: 'https://acme.atlassian.net/browse/PROJ-142',
    })
  })

  it('transition busca la transición por categoría y la ejecuta', async () => {
    const d = deps({
      '/transitions': { transitions: [
        { id: '31', to: { statusCategory: { key: 'indeterminate' } } },
        { id: '41', to: { statusCategory: { key: 'done' } } },
      ] },
    })
    const p = createJiraTicketProvider(d)
    await p.transition('10001', 'done')
    const calls = (d.fetch as ReturnType<typeof vi.fn>).mock.calls
    const post = calls.find(c => c[1]?.method === 'POST')
    expect(post?.[0]).toContain('/rest/api/3/issue/10001/transitions')
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({ transition: { id: '41' } })
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run electron/__tests__/tickets-providers.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
import type { PanelAdapterDeps } from '../integration-panels'
import type { Ticket, TicketProvider, TicketState } from './ticket-types'

// Jira REST v3. Config del adapter existente de Jira (hito 2): baseUrl + email;
// token = apiKey guardada en pluginCreds bajo 'jira'.
const CATEGORY_TO_STATE: Record<string, TicketState> = {
  new: 'todo', indeterminate: 'in_progress', done: 'done',
}
const STATE_TO_CATEGORY: Record<TicketState, string> = {
  todo: 'new', in_progress: 'indeterminate', in_review: 'indeterminate', done: 'done',
}

export function createJiraTicketProvider(deps: PanelAdapterDeps): TicketProvider {
  const cfg = deps.getConfig('jira') as { baseUrl?: string; email?: string }
  const base = (cfg.baseUrl ?? '').replace(/\/$/, '')
  const auth = () => 'Basic ' + Buffer.from(`${cfg.email}:${deps.getToken('jira')}`).toString('base64')
  const headers = () => ({ Authorization: auth(), Accept: 'application/json', 'Content-Type': 'application/json' })

  return {
    async listMyTickets(): Promise<Ticket[]> {
      const jql = encodeURIComponent('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC')
      const res = await deps.fetch(`${base}/rest/api/3/search?jql=${jql}&maxResults=50&fields=summary,description,status,comment`, { headers: headers() })
      if (!res.ok) throw new Error(`Jira ${res.status}`)
      const data = await res.json() as { issues: Array<{ id: string; key: string; fields: {
        summary: string; description: unknown
        status: { statusCategory: { key: string } }
        comment?: { comments: Array<{ author?: { displayName?: string }; body?: unknown }> }
      } }> }
      return data.issues.map(i => ({
        key: i.key,
        providerId: i.id,
        title: i.fields.summary,
        url: `${base}/browse/${i.key}`,
        state: CATEGORY_TO_STATE[i.fields.status.statusCategory.key] ?? 'todo',
        context: adfToText(i.fields.description) + commentsToText(i.fields.comment?.comments ?? []),
      }))
    },

    async transition(providerId, to): Promise<void> {
      const res = await deps.fetch(`${base}/rest/api/3/issue/${providerId}/transitions`, { headers: headers() })
      if (!res.ok) return
      const { transitions } = await res.json() as { transitions: Array<{ id: string; to: { statusCategory: { key: string } } }> }
      const target = transitions.find(t => t.to.statusCategory.key === STATE_TO_CATEGORY[to])
      if (!target) return // el workflow del proyecto no tiene esa transición: no-op
      await deps.fetch(`${base}/rest/api/3/issue/${providerId}/transitions`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ transition: { id: target.id } }),
      })
    },
  }
}

// Jira v3 devuelve description/comments en ADF (árbol). Extraemos solo texto:
// suficiente para TASK.md, sin dependencia nueva (YAGNI un renderer completo).
function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { text?: string; content?: unknown[] }
  const own = typeof n.text === 'string' ? n.text : ''
  const kids = Array.isArray(n.content) ? n.content.map(adfToText).join('') : ''
  return own + kids + ('content' in n ? '\n' : '')
}

function commentsToText(comments: Array<{ author?: { displayName?: string }; body?: unknown }>): string {
  if (comments.length === 0) return ''
  return '\n## Comments\n' + comments.map(c => `- **${c.author?.displayName ?? '?'}**: ${adfToText(c.body).trim()}`).join('\n')
}
```

- [ ] **Step 4: Verde + tsc**

Run: `npx vitest run electron/__tests__/tickets-providers.test.ts && npx tsc --noEmit`
Expected: 2 passed, tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/tickets-jira.ts electron/__tests__/tickets-providers.test.ts
git commit -m "feat(integrations): provider Jira del ticket loop (Task C)"
```

---

## Task D: Provider Linear

**Files:**
- Create: `electron/integrations/tickets-linear.ts`
- Test: agregar sección a `electron/__tests__/tickets-providers.test.ts`

- [ ] **Step 1: Test que falla** (agregar al archivo existente)

```typescript
import { createLinearTicketProvider } from '../integrations/tickets-linear'

describe('LinearTicketProvider', () => {
  it('lista assigned issues del viewer', async () => {
    const d = deps({
      'api.linear.app': { data: { viewer: { assignedIssues: { nodes: [{
        id: 'uuid-1', identifier: 'ENG-42', title: 'Ship it',
        url: 'https://linear.app/acme/issue/ENG-42',
        state: { type: 'started' },
        description: 'the spec',
        comments: { nodes: [{ user: { name: 'Bau' }, body: 'dale' }] },
      }] } } } },
    })
    const p = createLinearTicketProvider(d)
    const t = await p.listMyTickets()
    expect(t[0]).toMatchObject({ key: 'ENG-42', providerId: 'uuid-1', state: 'in_progress' })
    expect(t[0].context).toContain('the spec')
    expect(t[0].context).toContain('Bau')
  })

  it('transition muta el estado buscando el workflow state del team', async () => {
    const d = deps({
      'api.linear.app': { data: {
        issue: { team: { states: { nodes: [
          { id: 's-review', type: 'started', name: 'In Review' },
          { id: 's-done', type: 'completed', name: 'Done' },
        ] } } },
        issueUpdate: { success: true },
      } },
    })
    const p = createLinearTicketProvider(d)
    await p.transition('uuid-1', 'done')
    const calls = (d.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2) // query states + mutation
    expect(String(calls.at(-1)?.[1]?.body)).toContain('s-done')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run electron/__tests__/tickets-providers.test.ts`
Expected: FAIL en la sección Linear.

- [ ] **Step 3: Implementar**

```typescript
import type { PanelAdapterDeps } from '../integration-panels'
import type { Ticket, TicketProvider, TicketState } from './ticket-types'

// Linear GraphQL. Token = apiKey personal guardada en pluginCreds bajo 'linear'.
const TYPE_TO_STATE: Record<string, TicketState> = {
  triage: 'todo', backlog: 'todo', unstarted: 'todo',
  started: 'in_progress', completed: 'done', canceled: 'done',
}
// in_review: Linear lo modela como un state "started" con nombre; al transicionar
// preferimos matchear por nombre y caemos al tipo si no existe.
const STATE_TO_MATCH: Record<TicketState, { type: string; nameHint?: string }> = {
  todo: { type: 'unstarted' },
  in_progress: { type: 'started' },
  in_review: { type: 'started', nameHint: 'review' },
  done: { type: 'completed' },
}

const API = 'https://api.linear.app/graphql'

export function createLinearTicketProvider(deps: PanelAdapterDeps): TicketProvider {
  const gql = async (query: string, variables?: Record<string, unknown>) => {
    const res = await deps.fetch(API, {
      method: 'POST',
      headers: { Authorization: deps.getToken('linear') ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new Error(`Linear ${res.status}`)
    return (await res.json() as { data: Record<string, unknown> }).data
  }

  return {
    async listMyTickets(): Promise<Ticket[]> {
      const data = await gql(`query { viewer { assignedIssues(
        filter: { state: { type: { nin: ["completed","canceled"] } } }, first: 50
      ) { nodes {
        id identifier title url description
        state { type }
        comments(first: 20) { nodes { user { name } body } }
      } } } }`) as {
        viewer: { assignedIssues: { nodes: Array<{
          id: string; identifier: string; title: string; url: string
          description: string | null
          state: { type: string }
          comments: { nodes: Array<{ user: { name: string } | null; body: string }> }
        }> } }
      }
      return data.viewer.assignedIssues.nodes.map(n => ({
        key: n.identifier,
        providerId: n.id,
        title: n.title,
        url: n.url,
        state: TYPE_TO_STATE[n.state.type] ?? 'todo',
        context: (n.description ?? '') + (n.comments.nodes.length
          ? '\n## Comments\n' + n.comments.nodes.map(c => `- **${c.user?.name ?? '?'}**: ${c.body}`).join('\n')
          : ''),
      }))
    },

    async transition(providerId, to): Promise<void> {
      const match = STATE_TO_MATCH[to]
      const data = await gql(
        `query($id: String!) { issue(id: $id) { team { states { nodes { id type name } } } } }`,
        { id: providerId },
      ) as { issue: { team: { states: { nodes: Array<{ id: string; type: string; name: string }> } } } }
      const states = data.issue.team.states.nodes.filter(s => s.type === match.type)
      const target = (match.nameHint
        ? states.find(s => s.name.toLowerCase().includes(match.nameHint!))
        : undefined) ?? states[0]
      if (!target) return
      await gql(
        `mutation($id: String!, $state: String!) { issueUpdate(id: $id, input: { stateId: $state }) { success } }`,
        { id: providerId, state: target.id },
      )
    },
  }
}
```

- [ ] **Step 4: Verde + tsc**

Run: `npx vitest run electron/__tests__/tickets-providers.test.ts && npx tsc --noEmit`
Expected: 4 passed, tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/tickets-linear.ts electron/__tests__/tickets-providers.test.ts
git commit -m "feat(integrations): provider Linear del ticket loop (Task D)"
```

---

## Task E: Provider GitHub Issues

**Files:**
- Create: `electron/integrations/tickets-github.ts`
- Test: agregar sección a `electron/__tests__/tickets-providers.test.ts`

- [ ] **Step 1: Test que falla**

```typescript
import { createGitHubTicketProvider } from '../integrations/tickets-github'

describe('GitHubTicketProvider', () => {
  it('lista issues asignados (excluye PRs) con contexto de comments', async () => {
    const d = deps({
      '/issues?filter=assigned': [
        { number: 7, id: 1, title: 'Bug X', state: 'open',
          html_url: 'https://github.com/acme/app/issues/7',
          repository: { full_name: 'acme/app' },
          body: 'repro steps', comments: 0, pull_request: undefined },
        { number: 8, id: 2, title: 'soy un PR', state: 'open',
          html_url: 'x', repository: { full_name: 'acme/app' },
          body: '', comments: 0, pull_request: { url: 'x' } },
      ],
    })
    const p = createGitHubTicketProvider(d)
    const t = await p.listMyTickets()
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ key: 'acme/app#7', providerId: 'acme/app#7', state: 'todo' })
    expect(t[0].context).toContain('repro steps')
  })

  it('transition done cierra el issue; in_progress/in_review son no-op', async () => {
    const d = deps({ '/repos/acme/app/issues/7': { ok: true } })
    const p = createGitHubTicketProvider(d)
    await p.transition('acme/app#7', 'in_progress') // no-op
    await p.transition('acme/app#7', 'done')
    const calls = (d.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][1]?.method).toBe('PATCH')
    expect(JSON.parse(calls[0][1]?.body as string)).toEqual({ state: 'closed' })
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run electron/__tests__/tickets-providers.test.ts`
Expected: FAIL en la sección GitHub.

- [ ] **Step 3: Implementar**

```typescript
import type { PanelAdapterDeps } from '../integration-panels'
import type { Ticket, TicketProvider } from './ticket-types'

// GitHub Issues. Token: el OAuth de la app (pluginCreds 'github', mismo fallback
// que usa el adapter GitHub del hito 2). providerId = "owner/repo#number".
// GitHub no tiene estados intermedios: open/closed. in_progress/in_review = no-op
// (el estado real lo cuentan el branch y el PR — motor de inferencia, Task F).
const API = 'https://api.github.com'

export function createGitHubTicketProvider(deps: PanelAdapterDeps): TicketProvider {
  const headers = () => ({
    Authorization: `Bearer ${deps.getToken('github')}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  })

  return {
    async listMyTickets(): Promise<Ticket[]> {
      const res = await deps.fetch(`${API}/issues?filter=assigned&state=open&per_page=50`, { headers: headers() })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const issues = await res.json() as Array<{
        number: number; title: string; state: string; html_url: string
        repository: { full_name: string }
        body: string | null
        pull_request?: unknown
      }>
      return issues
        .filter(i => !i.pull_request) // /issues devuelve también PRs: afuera
        .map(i => ({
          key: `${i.repository.full_name}#${i.number}`,
          providerId: `${i.repository.full_name}#${i.number}`,
          title: i.title,
          url: i.html_url,
          state: 'todo' as const,
          context: i.body ?? '',
        }))
    },

    async transition(providerId, to): Promise<void> {
      if (to !== 'done') return
      const m = providerId.match(/^(.+)#(\d+)$/)
      if (!m) return
      await deps.fetch(`${API}/repos/${m[1]}/issues/${m[2]}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ state: 'closed' }),
      })
    },
  }
}
```

- [ ] **Step 4: Verde + tsc**

Run: `npx vitest run electron/__tests__/tickets-providers.test.ts && npx tsc --noEmit`
Expected: 6 passed, tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add electron/integrations/tickets-github.ts electron/__tests__/tickets-providers.test.ts
git commit -m "feat(integrations): provider GitHub Issues del ticket loop (Task E)"
```

---

## Task F: Registry + startWork + inferencia de estado

**Files:**
- Create: `electron/ticket-loop.ts`
- Test: `electron/__tests__/ticket-loop.test.ts`

- [ ] **Step 1: Test que falla**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TicketLoop } from '../ticket-loop'
import type { Ticket, TicketProvider } from '../integrations/ticket-types'

const ticket: Ticket = {
  key: 'PROJ-1', providerId: 'p1', title: 'Fix', url: 'u', state: 'todo', context: 'ctx',
}

function makeProvider(): TicketProvider {
  return { listMyTickets: vi.fn(async () => [ticket]), transition: vi.fn(async () => {}) }
}

describe('TicketLoop', () => {
  let provider: TicketProvider
  let loop: TicketLoop

  beforeEach(() => {
    provider = makeProvider()
    loop = new TicketLoop()
    loop.register('jira', () => provider)
  })

  it('list delega en el provider registrado', async () => {
    expect(await loop.list('jira', {} as never)).toEqual([ticket])
  })

  it('list con provider desconocido devuelve error tipado, no throw', async () => {
    await expect(loop.list('nope', {} as never)).resolves.toEqual([])
  })

  it('startWork transiciona a in_progress y registra el tracking branch→ticket', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    expect(provider.transition).toHaveBeenCalledWith('p1', 'in_progress')
    expect(loop.trackedTicket('gero/PROJ-1-fix')).toMatchObject({ providerId: 'p1', pluginId: 'jira' })
  })

  it('onPrStateChanged transiciona según el evento', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'in_review')
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
  })

  it('onPrStateChanged con branch no trackeado es no-op', async () => {
    await expect(loop.onPrStateChanged('otra/rama', 'merged', {} as never)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run electron/__tests__/ticket-loop.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
import type { PanelAdapterDeps } from './integration-panels'
import type { Ticket, TicketProviderFactory } from './integrations/ticket-types'

interface Tracked { pluginId: string; providerId: string; key: string }

// Motor 1: registry de providers + tracking branch→ticket para inferir estado.
// El tracking vive en memoria: si la app se reinicia, el polling de PRs (main.ts)
// re-detecta por nombre de rama de los worktrees vivos — el branch ES el vínculo
// persistente (patrón Linear), no necesitamos otra base de datos.
export class TicketLoop {
  private factories = new Map<string, TicketProviderFactory>()
  private tracked = new Map<string, Tracked>()

  register(pluginId: string, factory: TicketProviderFactory): void {
    this.factories.set(pluginId, factory)
  }

  registeredIds(): string[] { return [...this.factories.keys()] }

  private provider(pluginId: string, deps: PanelAdapterDeps) {
    const f = this.factories.get(pluginId)
    return f ? f(deps) : null
  }

  async list(pluginId: string, deps: PanelAdapterDeps): Promise<Ticket[]> {
    const p = this.provider(pluginId, deps)
    if (!p) return []
    try {
      return await p.listMyTickets()
    } catch (err) {
      console.warn('[ticket-loop] list failed', pluginId, err)
      return []
    }
  }

  async startWork(pluginId: string, ticket: Ticket, branch: string, deps: PanelAdapterDeps): Promise<void> {
    this.tracked.set(branch, { pluginId, providerId: ticket.providerId, key: ticket.key })
    const p = this.provider(pluginId, deps)
    if (!p) return
    try {
      await p.transition(ticket.providerId, 'in_progress')
    } catch (err) {
      // La transición es best-effort: el worktree ya se creó, no rompemos el flujo.
      console.warn('[ticket-loop] transition in_progress failed', ticket.key, err)
    }
  }

  trackedTicket(branch: string): Tracked | undefined { return this.tracked.get(branch) }

  async onPrStateChanged(branch: string, pr: 'open' | 'merged', deps: PanelAdapterDeps): Promise<void> {
    const t = this.tracked.get(branch)
    if (!t) return
    const p = this.provider(t.pluginId, deps)
    if (!p) return
    try {
      await p.transition(t.providerId, pr === 'open' ? 'in_review' : 'done')
      if (pr === 'merged') this.tracked.delete(branch)
    } catch (err) {
      console.warn('[ticket-loop] transition on PR', pr, t.key, err)
    }
  }
}

export const ticketLoop = new TicketLoop()
```

- [ ] **Step 4: Verde + tsc**

Run: `npx vitest run electron/__tests__/ticket-loop.test.ts && npx tsc --noEmit`
Expected: 5 passed, tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add electron/ticket-loop.ts electron/__tests__/ticket-loop.test.ts
git commit -m "feat(integrations): TicketLoop — registry, startWork y transiciones por PR (Task F)"
```

---

## Task G: IPC + preload + registro

**Files:**
- Modify: `electron/main.ts` (junto al handler `plugins:panel:call`, ~línea 2241)
- Modify: `electron/integrations/register.ts`
- Modify: `electron/preload.ts` (~línea 273, junto a pluginPanels)
- Modify: `src/types.ts` (tipos del bridge)

- [ ] **Step 1: Registrar providers en register.ts** (agregar al final de `registerAllPanelAdapters()` o crear función hermana llamada desde el mismo lugar de main.ts)

```typescript
import { ticketLoop } from '../ticket-loop'
import { createJiraTicketProvider } from './tickets-jira'
import { createLinearTicketProvider } from './tickets-linear'
import { createGitHubTicketProvider } from './tickets-github'

export function registerAllTicketProviders(): void {
  ticketLoop.register('jira', createJiraTicketProvider)
  ticketLoop.register('linear', createLinearTicketProvider)
  ticketLoop.register('github', createGitHubTicketProvider)
}
```

Y en `electron/main.ts`, junto a la llamada existente `registerAllPanelAdapters()` (~línea 2240): agregar `registerAllTicketProviders()`.

- [ ] **Step 2: Handlers IPC en main.ts** (mismo bloque, reusar el armado de `deps` del handler `plugins:panel:call`)

```typescript
import { ticketLoop } from './ticket-loop'
import { ticketBranchName } from './integrations/branch-name'
import { writeFileSync as writeTaskFile, mkdirSync as mkTaskDir } from 'fs'
import { join as joinTask } from 'path'

// IMPORTANTE: copiar EXACTAMENTE el objeto deps que arma el handler existente
// `plugins:panel:call` (main.ts ~2241) — misma fuente de getToken/getConfig/fetch.
// No inventar firmas: si getConfig sale de otro store, usar ese.
const panelDeps = (): PanelAdapterDeps => ({ /* copiar del handler existente */ } as PanelAdapterDeps)

ipcMain.handle('tickets:list', (_e, pluginId: string) => {
  if (typeof pluginId !== 'string') return []
  return ticketLoop.list(pluginId, panelDeps())
})

ipcMain.handle('tickets:branchName', (_e, user: string, key: string, title: string) =>
  ticketBranchName(String(user ?? ''), String(key ?? ''), String(title ?? '')))

// Se llama DESPUÉS de que worktree:create devolvió ok: escribe TASK.md con el
// contexto y dispara la transición a in_progress. worktreePath viene del retorno
// de worktree:create (meta.path) — validamos que exista y sea dir por las dudas.
ipcMain.handle('tickets:startWork', async (_e, args: {
  pluginId: string; ticket: unknown; branch: string; worktreePath: string
}) => {
  const { pluginId, ticket, branch, worktreePath } = args ?? {}
  if (typeof pluginId !== 'string' || typeof branch !== 'string' || typeof worktreePath !== 'string') {
    return { ok: false as const, error: 'BAD_ARGS' }
  }
  const t = ticket as import('./integrations/ticket-types').Ticket
  try {
    if (!existsSync(worktreePath) || !statSync(worktreePath).isDirectory()) {
      return { ok: false as const, error: 'NO_WORKTREE' }
    }
    const dir = joinTask(worktreePath, '.nest')
    mkTaskDir(dir, { recursive: true })
    // La última línea cubre el "Fixes <ID>" de la spec: el agente que labura en
    // este worktree la lee y la incluye en la descripción del PR.
    writeTaskFile(joinTask(dir, 'TASK.md'),
      `# ${t.key}: ${t.title}\n\n${t.url}\n\n${t.context}\n\n---\n` +
      `Cuando abras el PR de esta tarea, incluí "Fixes ${t.key}" en la descripción.\n`)
  } catch (err) {
    console.warn('[tickets:startWork] TASK.md write failed', err)
  }
  await ticketLoop.startWork(pluginId, t, branch, panelDeps())
  return { ok: true as const }
})
```

(Nota: `existsSync`/`statSync` ya están importados en main.ts; los alias `writeTaskFile`/`mkTaskDir`/`joinTask` evitan colisión con imports existentes — ajustar a los nombres ya importados si main.ts ya los tiene, que es lo probable: usar los existentes.)

- [ ] **Step 3: Preload** (junto a `pluginPanels`)

```typescript
contextBridge.exposeInMainWorld('tickets', {
  list: (pluginId: string) => ipcRenderer.invoke('tickets:list', pluginId),
  branchName: (user: string, key: string, title: string) =>
    ipcRenderer.invoke('tickets:branchName', user, key, title),
  startWork: (args: { pluginId: string; ticket: unknown; branch: string; worktreePath: string }) =>
    ipcRenderer.invoke('tickets:startWork', args),
})
```

- [ ] **Step 4: Tipos del bridge en src/types.ts** (junto a los otros `window.*`)

```typescript
export interface TicketsBridge {
  list: (pluginId: string) => Promise<import('../electron/integrations/ticket-types').Ticket[]>
  branchName: (user: string, key: string, title: string) => Promise<string>
  startWork: (args: {
    pluginId: string
    ticket: import('../electron/integrations/ticket-types').Ticket
    branch: string
    worktreePath: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}
// y en la declaración global de Window: tickets: TicketsBridge
```

(Si `src/types.ts` no puede importar de `electron/` por project references, duplicar el tipo `Ticket` en `src/types.ts` — verificar cómo lo resuelve `WorktreeMeta`, que ya es compartido.)

- [ ] **Step 5: tsc + suite entera**

Run: `npx tsc --noEmit && npm test`
Expected: limpio; los fails preexistentes de entorno macOS (worktree-store) no aumentan.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts electron/integrations/register.ts src/types.ts
git commit -m "feat(integrations): IPC tickets:* + bridge window.tickets (Task G)"
```

---

## Task H: Hook useMyTickets

**Files:**
- Create: `src/hooks/useMyTickets.ts`
- Test: `src/__tests__/hooks/useMyTickets.test.ts`

- [ ] **Step 1: Test que falla**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMyTickets } from '../../hooks/useMyTickets'

const list = vi.fn()
beforeEach(() => {
  list.mockReset()
  ;(window as unknown as { tickets: { list: typeof list } }).tickets = { list }
})

describe('useMyTickets', () => {
  it('carga tickets del provider', async () => {
    list.mockResolvedValue([{ key: 'A-1', providerId: 'p', title: 't', url: 'u', state: 'todo', context: '' }])
    const { result } = renderHook(() => useMyTickets('jira'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tickets).toHaveLength(1)
    expect(list).toHaveBeenCalledWith('jira')
  })

  it('pluginId null no llama y devuelve vacío', async () => {
    const { result } = renderHook(() => useMyTickets(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(list).not.toHaveBeenCalled()
    expect(result.current.tickets).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/__tests__/hooks/useMyTickets.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { Ticket } from '../types'

export function useMyTickets(pluginId: string | null) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(pluginId != null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!pluginId) { setTickets([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setTickets(await window.tickets.list(pluginId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [pluginId])

  useEffect(() => { void reload() }, [reload])

  return { tickets, loading, error, reload }
}
```

(`Ticket` re-exportado desde `src/types.ts` según lo resuelto en Task G Step 4.)

- [ ] **Step 4: Verde**

Run: `npx vitest run src/__tests__/hooks/useMyTickets.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMyTickets.ts src/__tests__/hooks/useMyTickets.test.ts
git commit -m "feat(integrations): hook useMyTickets (Task H)"
```

---

## Task I: MyTicketsView + Work on this

**Files:**
- Create: `src/components/IntegrationPanel/MyTicketsView.tsx`
- Modify: `src/components/MyReposPanel.tsx` (donde monta `IntegrationPanelShell`, ~línea 416)
- Modify: `src/styles/global.css` (clases `.tk-*` al final)
- Test: `src/__tests__/components/MyTicketsView.test.tsx`

- [ ] **Step 1: Test que falla**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import MyTicketsView from '../../components/IntegrationPanel/MyTicketsView'

const ticket = { key: 'PROJ-1', providerId: 'p1', title: 'Fix auth', url: 'u', state: 'todo' as const, context: 'ctx' }

beforeEach(() => {
  ;(window as never as Record<string, unknown>).tickets = {
    list: vi.fn().mockResolvedValue([ticket]),
    branchName: vi.fn().mockResolvedValue('gero/PROJ-1-fix-auth'),
    startWork: vi.fn().mockResolvedValue({ ok: true }),
  }
  ;(window as never as Record<string, unknown>).worktree = {
    create: vi.fn().mockResolvedValue({ ok: true, meta: { path: '/tmp/wt' } }),
  }
})

describe('MyTicketsView', () => {
  it('lista los tickets asignados', async () => {
    render(<MyTicketsView pluginId="jira" repoPath="/repo" githubLogin="gero" onOpenWorktree={() => {}} />)
    await waitFor(() => expect(screen.getByText('Fix auth')).toBeTruthy())
    expect(screen.getByText('PROJ-1')).toBeTruthy()
  })

  it('Work on this: crea worktree con el branch del ticket y notifica', async () => {
    const onOpen = vi.fn()
    render(<MyTicketsView pluginId="jira" repoPath="/repo" githubLogin="gero" onOpenWorktree={onOpen} />)
    await waitFor(() => screen.getByText('Fix auth'))
    fireEvent.click(screen.getByRole('button', { name: /work on this/i }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/tmp/wt'))
    const wt = (window as never as { worktree: { create: ReturnType<typeof vi.fn> } }).worktree
    expect(wt.create).toHaveBeenCalledWith({ repoPath: '/repo', branch: 'gero/PROJ-1-fix-auth' })
    const tk = (window as never as { tickets: { startWork: ReturnType<typeof vi.fn> } }).tickets
    expect(tk.startWork).toHaveBeenCalledWith({
      pluginId: 'jira', ticket, branch: 'gero/PROJ-1-fix-auth', worktreePath: '/tmp/wt',
    })
  })

  it('si worktree.create falla muestra el error y NO llama startWork', async () => {
    ;(window as never as { worktree: { create: ReturnType<typeof vi.fn> } }).worktree.create =
      vi.fn().mockResolvedValue({ ok: false, error: 'branch exists' })
    render(<MyTicketsView pluginId="jira" repoPath="/repo" githubLogin="gero" onOpenWorktree={() => {}} />)
    await waitFor(() => screen.getByText('Fix auth'))
    fireEvent.click(screen.getByRole('button', { name: /work on this/i }))
    await waitFor(() => expect(screen.getByText(/branch exists/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/__tests__/components/MyTicketsView.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el componente**

```tsx
import { useState } from 'react'
import { useMyTickets } from '../../hooks/useMyTickets'
import type { Ticket } from '../../types'

interface Props {
  pluginId: string
  repoPath: string
  /** login para el prefijo del branch (de useGitHub o del perfil) */
  githubLogin: string | null
  /** el caller abre el flujo de pane sobre el worktree nuevo (setAddingPane) */
  onOpenWorktree: (worktreePath: string) => void
}

export default function MyTicketsView({ pluginId, repoPath, githubLogin, onOpenWorktree }: Props) {
  const { tickets, loading, error, reload } = useMyTickets(pluginId)
  const [working, setWorking] = useState<string | null>(null) // key en vuelo: deshabilita doble click
  const [actionError, setActionError] = useState<string | null>(null)

  async function workOn(t: Ticket) {
    if (working) return
    setWorking(t.key)
    setActionError(null)
    try {
      const branch = await window.tickets.branchName(githubLogin ?? '', t.key, t.title)
      const res = await window.worktree.create({ repoPath, branch })
      if (!res.ok) { setActionError(res.error ?? 'worktree failed'); return }
      await window.tickets.startWork({ pluginId, ticket: t, branch, worktreePath: res.meta.path })
      onOpenWorktree(res.meta.path)
    } finally {
      setWorking(null)
    }
  }

  if (loading) return <div className="tk-empty">Loading tickets…</div>
  if (error) return <div className="tk-empty">{error} <button className="tk-retry" onClick={() => void reload()}>Retry</button></div>
  if (tickets.length === 0) return <div className="tk-empty">No open tickets assigned to you</div>

  return (
    <div className="tk-list">
      {actionError && <div className="tk-error" role="alert">{actionError}</div>}
      {tickets.map(t => (
        <div key={t.key} className="tk-row">
          <div className="tk-info">
            <span className="tk-key">{t.key}</span>
            <span className="tk-title">{t.title}</span>
          </div>
          <button
            className="tk-work-btn"
            disabled={working !== null}
            onClick={() => void workOn(t)}
          >
            {working === t.key ? 'Creating…' : 'Work on this'}
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: CSS** — agregar al FINAL de `src/styles/global.css`, prefijo `.tk-`, solo tokens existentes (`var(--text-muted)`, `var(--raven-blue)`, etc.; cero colores hardcodeados):

```css
/* ── Ticket loop (My tickets) ─────────────────────────────────────── */
.tk-list { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.tk-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--border, #2a2a2a); border-radius: 8px; }
.tk-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tk-key { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono, monospace); }
.tk-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-work-btn { flex-shrink: 0; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
.tk-work-btn:disabled { opacity: 0.5; cursor: default; }
.tk-empty { padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
.tk-error { padding: 8px 10px; font-size: 12px; color: var(--danger, #ff5555); }
.tk-retry { margin-left: 6px; }
```

(Verificar que `--border` y `--danger` existen en global.css; si no, usar los tokens reales equivalentes que ya use `IntegrationPanelShell`.)

- [ ] **Step 5: Montarlo en MyReposPanel** — donde renderiza `IntegrationPanelShell` (~línea 416), agregar un toggle de vista "Tickets" para los pluginIds con ticket provider (`jira`, `linear`, `github`), pasando:

```tsx
<MyTicketsView
  pluginId={activeIntegrationId}
  repoPath={repoPath}
  githubLogin={githubLogin}
  onOpenWorktree={(path) => setAddingPane({ worktreePath: path })}
/>
```

`setAddingPane` llega por la misma cadena de props con la que MyReposPanel dispara paneles hoy — si no está disponible directo, subir el callback por props desde App.tsx igual que hace `onOpenRepoTerminal`.

- [ ] **Step 6: Verde + suite + tsc**

Run: `npx vitest run src/__tests__/components/MyTicketsView.test.tsx && npx tsc --noEmit && npm test`
Expected: 3 passed; suite sin regresiones nuevas.

- [ ] **Step 7: Commit**

```bash
git add src/components/IntegrationPanel/MyTicketsView.tsx src/components/MyReposPanel.tsx src/hooks/useMyTickets.ts src/styles/global.css src/__tests__/components/MyTicketsView.test.tsx
git commit -m "feat(integrations): vista My tickets + Work on this → worktree con contexto (Task I)"
```

---

## Task J: Polling de PRs → transiciones (in_review / done)

**Files:**
- Modify: `electron/ticket-loop.ts` (agregar `pollOnce`)
- Modify: `electron/main.ts` (interval de 90s)
- Test: agregar a `electron/__tests__/ticket-loop.test.ts`

- [ ] **Step 1: Test que falla**

```typescript
it('pollOnce consulta PRs por branch trackeado y dispara transiciones', async () => {
  await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
  const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('state=all')) {
      return new Response(JSON.stringify([{ state: 'closed', merged_at: '2026-07-12T00:00:00Z' }]), { status: 200 })
    }
    return new Response('[]', { status: 200 })
  })
  const deps = { getToken: () => 'tok', getConfig: () => ({}), fetch: fetchMock as unknown as typeof fetch }
  await loop.pollOnce('acme/app', deps)
  expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run electron/__tests__/ticket-loop.test.ts`
Expected: FAIL — `pollOnce` no existe.

- [ ] **Step 3: Implementar `pollOnce` en TicketLoop**

```typescript
  /**
   * Consulta GitHub por cada branch trackeado dentro de repoFullName y dispara
   * las transiciones. Se llama desde main.ts cada 90s SOLO si hay branches
   * trackeados (cero requests en reposo — cuidar el rate limit).
   */
  async pollOnce(repoFullName: string, deps: PanelAdapterDeps): Promise<void> {
    for (const [branch] of this.tracked) {
      try {
        const res = await deps.fetch(
          `https://api.github.com/repos/${repoFullName}/pulls?head=${encodeURIComponent(repoFullName.split('/')[0] + ':' + branch)}&state=all&per_page=1`,
          { headers: { Authorization: `Bearer ${deps.getToken('github')}`, Accept: 'application/vnd.github.v3+json' } },
        )
        if (!res.ok) continue
        const prs = await res.json() as Array<{ state: string; merged_at: string | null }>
        if (prs.length === 0) continue
        if (prs[0].merged_at) await this.onPrStateChanged(branch, 'merged', deps)
        else if (prs[0].state === 'open') await this.onPrStateChanged(branch, 'open', deps)
      } catch (err) {
        console.warn('[ticket-loop] poll failed', branch, err)
      }
    }
  }
```

Y en `electron/main.ts` (cerca de los otros intervals): cada 90s, si `ticketLoop` tiene tracked y hay un repo activo con remote GitHub (`getRemoteUrl` ya existe en `electron/integrations/github.ts`), llamar `ticketLoop.pollOnce(repoFullName, panelDeps())`. Nota: v1 solo infiere PRs en repos GitHub; Jira/Linear con repos no-GitHub quedan en in_progress hasta transición manual en la plataforma (documentado en el panel con un tooltip).

- [ ] **Step 4: Verde + tsc + suite**

Run: `npx vitest run electron/__tests__/ticket-loop.test.ts && npx tsc --noEmit && npm test`
Expected: 6 passed en ticket-loop; suite sin regresiones.

- [ ] **Step 5: Commit**

```bash
git add electron/ticket-loop.ts electron/main.ts electron/__tests__/ticket-loop.test.ts
git commit -m "feat(integrations): polling de PRs por branch → in_review/done (Task J)"
```

---

## Task K: Verificación end-to-end y cierre

- [ ] **Step 1: Suite completa + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: verde (fails preexistentes de entorno macOS no aumentan).

- [ ] **Step 2: Smoke en la app real** (`doppler run -- npm run dev`)

1. Conectar Jira (o GitHub) en integraciones.
2. Abrir "My tickets" → aparecen los asignados.
3. "Work on this" en uno → se crea el worktree con la rama `user/KEY-slug`, se abre el flujo de pane, y `.nest/TASK.md` existe con el contexto.
4. Verificar en Jira que el ticket pasó a In Progress.
5. Abrir un PR de esa rama → en ≤2 min el ticket pasa a In Review.

- [ ] **Step 3: Playwright smoke** — agregar caso a `e2e/01-integrations-demo.spec.ts`: la vista tickets renderiza sin crash con el mock adapter (patrón existente del archivo).

- [ ] **Step 4: Actualizar la spec** — marcar H3 como implementado en `docs/superpowers/specs/2026-07-11-integrations-task-loop-design.md` (línea de estado).

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "feat(integrations): H3 ticket loop completo — verificación e2e (Task K)"
```
