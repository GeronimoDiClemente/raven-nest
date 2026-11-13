# H5 — Slack accionable + Notion spec-to-worktree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox `- [ ]`.

**Goal:** Enrutar los eventos del ciclo propio a Slack (notify dirigido + auto-status) y bajar un doc de Notion como spec inicial de un worktree.

**Architecture:** Recetas nuevas en el bus (`pr.merged`/`ci.failed`/`changes.requested`/`review.requested` → `notify`); `worktree-signals` (H4) ahora EMITE `changes.requested`/`review.requested`; comando `setPresence` (Slack profile). Notion: `blocksToMarkdown` + IPC `notion:specToWorktree` que escribe `.nest/spec.md` e inyecta como `initialInput` (H4).

**Tech Stack:** Electron main/preload/renderer, TS, React, vitest. Slack Web API, Notion API.

**Spec:** `docs/superpowers/specs/2026-07-30-h5-slack-notion-design.md`. Depende de H4 (mergeado en `feat/integrations`).

---

## File Structure
- Modify: `electron/integrations/worktree-signals.ts` — emitir `changes.requested` (transición) + `review.requested` (search global), con dedup.
- Modify: `electron/integrations/recipes.ts` — recetas notify default + `session.opened → setPresence`.
- Modify: `electron/integrations/bus-types.ts` — `SetPresenceCommand` + guard.
- Modify: `electron/integrations/bus-commands.ts` — handler `setPresence`; `notify` resuelve channel desde config.
- Modify: `electron/integrations/notion.ts` — `blocksToMarkdown` + `fetchPageMarkdown`.
- Modify: `electron/main.ts`, `electron/preload.ts` — IPC `notion:specToWorktree`, `window.notion`.
- Modify: `src/components/IntegrationPanel/IntegrationPanelShell.tsx` (+ `MyReposPanel.tsx`) — botón "Work on this" para notion.
- Tests: `worktree-signals.test.ts`, `recipes.test.ts`, `bus-types.test.ts`, `bus-commands.test.ts`, `notion.test.ts`.

---

## Task 1: `worktree-signals` emite `changes.requested` (transición false→true, dedup)

**Files:** Modify `electron/integrations/worktree-signals.ts`; Test `electron/__tests__/worktree-signals.test.ts`.

- [ ] **Step 1: Failing test**

```ts
it('emite changes.requested cuando el PR pasa a CHANGES_REQUESTED, una sola vez', async () => {
  let state = 'APPROVED'
  const deps = depsWith(async (url) => {
    if (url.includes('/actions/runs')) return runsResp('success')
    if (url.includes('/pulls?')) return prResp(7)
    if (url.includes('/reviews')) return new Response(JSON.stringify([{ user: { login: 'a' }, state, submitted_at: '2026-01-02T00:00:00Z' }]), { status: 200 })
    return new Response('[]', { status: 200 })
  })
  const emit = vi.fn(async (_ev: unknown, _deps: unknown) => ({ commands: [], failed: [] }))
  const s = new WorktreeSignals(() => 'acme/app')
  s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
  const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
  await s.poll(wts, deps)                       // APPROVED → no emite
  state = 'CHANGES_REQUESTED'
  await s.poll(wts, deps)                       // transición → emite
  await s.poll(wts, deps)                       // sigue en CHANGES_REQUESTED → no re-emite
  const cr = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'changes.requested')
  expect(cr).toHaveLength(1)
  expect(cr[0][0]).toMatchObject({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'acme/app', prNumber: 7 })
})
```

(Usa el helper `prResp`/`runsResp` ya definidos en el archivo por H4; si `prResp` no existe, agregá `const prResp = (n) => new Response(JSON.stringify([{ number: n, head: { ref: 'feat/x' } }]), { status: 200 })`.)

- [ ] **Step 2:** Run `npx vitest run electron/__tests__/worktree-signals.test.ts` → FAIL (no emite changes.requested).

- [ ] **Step 3:** En `pollOne`, leer el estado previo y emitir en la transición. Antes del `this.state.set(...)`:

```ts
    const prev = this.state.get(wt.repoPath)
    // ... (cálculo de changesRequested/prNumber ya existente) ...
    this.state.set(wt.repoPath, { ci, repo, runId: failedRun?.id, runUrl: failedRun?.html_url, changesRequested, prNumber })

    // changes.requested: emitir SOLO en la transición a true (no en cada ciclo).
    if (this.bus && changesRequested && !prev?.changesRequested && prNumber) {
      const ev: DomainEvent = { type: 'changes.requested', branch: wt.branch, repoFullName: repo, prNumber }
      await this.bus.emit(ev, deps)
    }
```

- [ ] **Step 4:** Run test → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(h5): worktree-signals emite changes.requested en la transición (dedup)"`

---

## Task 2: `worktree-signals` emite `review.requested` (search global, dedup)

**Files:** Modify `electron/integrations/worktree-signals.ts`; Test idem.

- [ ] **Step 1: Failing test**

```ts
it('emite review.requested por cada PR nuevo del search, sin repetir', async () => {
  const searchResp = new Response(JSON.stringify({ items: [
    { number: 11, title: 'Fix A', repository_url: 'https://api.github.com/repos/acme/app' },
  ] }), { status: 200 })
  const deps = depsWith(async (url) => {
    if (url.includes('/search/issues')) return searchResp
    return new Response('[]', { status: 200 })
  })
  const emit = vi.fn(async (_ev: unknown, _deps: unknown) => ({ commands: [], failed: [] }))
  const s = new WorktreeSignals(() => 'acme/app')
  s.attachBus({ emit } as unknown as import('../integrations/event-bus').EventBus)
  await s.pollReviewRequests(deps)
  await s.pollReviewRequests(deps) // mismo PR → no re-emite
  const rr = emit.mock.calls.filter((c) => (c[0] as { type: string }).type === 'review.requested')
  expect(rr).toHaveLength(1)
  expect(rr[0][0]).toMatchObject({ type: 'review.requested', repoFullName: 'acme/app', prNumber: 11, prTitle: 'Fix A' })
})
```

- [ ] **Step 2:** Run → FAIL (`pollReviewRequests` no existe).

- [ ] **Step 3:** Agregar campo `private reviewNotified = new Set<number>()` y el método:

```ts
  /** Global (no por worktree): PRs donde me pidieron review. Emite review.requested por PR nuevo. */
  async pollReviewRequests(deps: PanelAdapterDeps): Promise<void> {
    if (!this.bus) return
    const json = await this.gh<{ items?: Array<{ number: number; title: string; repository_url: string }> }>(
      deps, `/search/issues?q=${encodeURIComponent('review-requested:@me type:pr state:open')}`,
    )
    for (const it of json?.items ?? []) {
      if (this.reviewNotified.has(it.number)) continue
      this.reviewNotified.add(it.number)
      const repoFullName = it.repository_url.replace('https://api.github.com/repos/', '')
      const ev: DomainEvent = { type: 'review.requested', repoFullName, prNumber: it.number, prTitle: it.title }
      await this.bus.emit(ev, deps)
    }
  }
```

- [ ] **Step 4:** Run → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(h5): worktree-signals emite review.requested desde el search (dedup)"`

Nota: el poller de `main.ts` (Task 5) llamará `pollReviewRequests` una vez por ciclo, además del `poll` por worktree.

---

## Task 3: Recetas notify + `notify` resuelve channel desde config

**Files:** Modify `electron/integrations/recipes.ts`, `electron/integrations/bus-commands.ts`; Test `electron/__tests__/recipes.test.ts`, `bus-commands.test.ts`.

- [ ] **Step 1: Failing test** (`recipes.test.ts`, dentro del describe de defaults)

```ts
it('pr.merged y ci.failed y changes.requested y review.requested producen notify', () => {
  const recipes = defaultRecipes(() => ({ pluginId: 'jira', providerId: 'P-1' }))
  const cmdsFor = (ev: DomainEvent) => recipes.filter(r => r.when === ev.type).flatMap(r => r.then(ev))
  expect(cmdsFor({ type: 'ci.failed', branch: 'feat/x', repoFullName: 'o/r', runUrl: 'u' } as DomainEvent)
    .some(c => c.cmd === 'notify')).toBe(true)
  expect(cmdsFor({ type: 'changes.requested', branch: 'feat/x', repoFullName: 'o/r', prNumber: 3 } as DomainEvent)
    .some(c => c.cmd === 'notify')).toBe(true)
  expect(cmdsFor({ type: 'review.requested', repoFullName: 'o/r', prNumber: 3, prTitle: 't' } as DomainEvent)
    .some(c => c.cmd === 'notify')).toBe(true)
})
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** En `defaultRecipes`, agregar al array de retorno (el channel va vacío — lo resuelve el handler):

```ts
    { id: 'h5:pr.merged→notify', when: 'pr.merged',
      then: (ev) => [{ cmd: 'notify', channel: '', message: `✅ PR mergeado en ${(ev as { repoFullName: string }).repoFullName} (${(ev as { branch: string }).branch})` }] },
    { id: 'h5:ci.failed→notify', when: 'ci.failed',
      then: (ev) => { const e = ev as { branch: string; runUrl?: string }; return [{ cmd: 'notify', channel: '', message: `🔴 CI rojo en ${e.branch}${e.runUrl ? ` — ${e.runUrl}` : ''}` }] } },
    { id: 'h5:changes.requested→notify', when: 'changes.requested',
      then: (ev) => { const e = ev as { repoFullName: string; prNumber: number }; return [{ cmd: 'notify', channel: '', message: `✏️ Te pidieron cambios en PR #${e.prNumber} (${e.repoFullName})` }] } },
    { id: 'h5:review.requested→notify', when: 'review.requested',
      then: (ev) => { const e = ev as { repoFullName: string; prNumber: number; prTitle: string }; return [{ cmd: 'notify', channel: '', message: `👀 Te pidieron revisar PR #${e.prNumber}: ${e.prTitle}` }] } },
```

- [ ] **Step 4:** `bus-commands.test.ts` — test de que notify usa el channel de config cuando el cmd trae channel vacío:

```ts
it('notify con channel vacío usa deps.getConfig(slack).channel', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  const deps = { getToken: () => 'tok', getConfig: () => ({ channel: '#builds' }), fetch } as unknown as PanelAdapterDeps
  const bus = new EventBus()
  registerBusCommands(bus, { ticketLoop: { providerFor: () => null } })
  bus.setRecipes([{ id: 'r', when: 'ci.failed', then: () => [{ cmd: 'notify', channel: '', message: 'hola' }] }])
  await bus.emit({ type: 'ci.failed', branch: 'b', repoFullName: 'o/r' } as DomainEvent, deps)
  const body = JSON.parse((fetch.mock.calls[0][1] as { body: string }).body)
  expect(body.channel).toBe('#builds')
})
```

- [ ] **Step 5:** En `bus-commands.ts` `handleNotify`, resolver el channel:

```ts
  const channel = cmd.channel || String((deps.getConfig('slack') as { channel?: unknown }).channel ?? '')
  if (!channel) { console.warn('[bus-commands] notify sin channel (cmd ni config)'); return }
  // ...usar `channel` en el body en vez de cmd.channel...
```

- [ ] **Step 6:** Run ambos tests → PASS. **Commit** `git commit -m "feat(h5): recetas notify por evento + notify resuelve channel desde config"`

---

## Task 4: Comando `setPresence` + handler + receta session.opened

**Files:** Modify `bus-types.ts`, `bus-commands.ts`, `recipes.ts`; Test `bus-types.test.ts`, `bus-commands.test.ts`.

- [ ] **Step 1: Failing test** (`bus-types.test.ts`)

```ts
it('setPresence válido', () => {
  expect(isCommand({ cmd: 'setPresence', text: 'focus: X' })).toBe(true)
  expect(isCommand({ cmd: 'setPresence' })).toBe(false)
})
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** En `bus-types.ts`: `export interface SetPresenceCommand { cmd: 'setPresence'; text: string; emoji?: string }`; agregar a la unión `Command`; en `isCommand` `case 'setPresence': return isStr(c.text) && optStr(c.emoji)`.

- [ ] **Step 4:** Handler en `bus-commands.ts` (test primero: verifica POST a `users.profile.set` con status_text). Implementación:

```ts
async function handleSetPresence(cmd: SetPresenceCommand, deps: PanelAdapterDeps): Promise<void> {
  const token = deps.getToken('slack')
  if (!token) { console.warn('[bus-commands] setPresence sin token de Slack, no-op'); return }
  try {
    const res = await deps.fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ profile: { status_text: cmd.text, status_emoji: cmd.emoji ?? ':hammer_and_wrench:' } }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!json.ok) console.warn('[bus-commands] setPresence no-ok', json.error)
  } catch (err) { console.warn('[bus-commands] setPresence falló', err) }
}
```

Registrar en `registerBusCommands`: `bus.registerHandler('setPresence', async (cmd, _ev, deps) => { await handleSetPresence(cmd as SetPresenceCommand, deps) })`.

- [ ] **Step 5:** Receta en `recipes.ts`: `{ id: 'h5:session.opened→presence', when: 'session.opened', then: (ev) => [{ cmd: 'setPresence', text: `focus: ${(ev as { branch: string }).branch}` }] }`. (El clear en `session.closed` queda como follow-up — hoy nadie emite `session.closed`.)

- [ ] **Step 6:** Run tests → PASS. **Commit** `git commit -m "feat(h5): comando setPresence (Slack status) + receta session.opened"`

---

## Task 5: IPC wiring — poller review-requests + notion (parcial)

**Files:** Modify `electron/main.ts`.

- [ ] **Step 1:** En el `setInterval` de `TICKET_POLL_MS` (donde H4 agregó `worktreeSignals.poll(...)`), agregar la llamada global:

```ts
  void worktreeSignals.pollReviewRequests(panelDeps())
```

- [ ] **Step 2:** Run `npx vitest run` (nada se rompe) + typecheck node (`npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep -E "worktree-signals|recipes|bus-commands|bus-types|main.ts" | grep -v "import.meta|OpenDialogOptions" || echo OK`).

- [ ] **Step 3: Commit** `git commit -m "feat(h5): poller llama pollReviewRequests por ciclo"`

---

## Task 6: Notion `blocksToMarkdown` + `fetchPageMarkdown`

**Files:** Modify `electron/integrations/notion.ts`; Test `electron/__tests__/notion.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { blocksToMarkdown } from '../integrations/notion'
it('blocksToMarkdown serializa text/code/heading', () => {
  const md = blocksToMarkdown([
    { kind: 'text', text: '# Título' },
    { kind: 'text', text: 'párrafo' },
    { kind: 'code', code: 'npm test', tag: 'sh' },
  ])
  expect(md).toContain('# Título')
  expect(md).toContain('párrafo')
  expect(md).toContain('```sh\nnpm test\n```')
})
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** En `notion.ts`:

```ts
import type { DetailBlock } from '../integration-panels'
export function blocksToMarkdown(blocks: DetailBlock[]): string {
  return blocks.map((b) => {
    if (b.kind === 'code') return '```' + (b.tag ?? '') + '\n' + b.code + '\n```'
    if (b.kind === 'comment') return `> ${b.author}: ${b.text}`
    return b.text
  }).join('\n\n')
}
export async function fetchPageMarkdown(deps: PanelAdapterDeps, pageId: string): Promise<string> {
  const [page, blocksRes] = await Promise.all([
    notionFetch<NotionPage>(deps, `/pages/${pageId}`),
    notionFetch<{ results: NotionBlock[] }>(deps, `/blocks/${pageId}/children?page_size=100`),
  ])
  return `# ${pageTitle(page)}\n\n${blocksToMarkdown(notionBlocksToDetail(blocksRes.results ?? []))}`
}
```

- [ ] **Step 4:** Run → PASS. **Commit** `git commit -m "feat(h5): notion blocksToMarkdown + fetchPageMarkdown"`

---

## Task 7: IPC `notion:specToWorktree` + botón "Work on this" (Notion)

**Files:** Modify `electron/main.ts`, `electron/preload.ts`, `src/components/IntegrationPanel/IntegrationPanelShell.tsx`, `src/components/MyReposPanel.tsx`, `src/types.ts`.

- [ ] **Step 1:** `main.ts` — handler (reusa el patrón de `tickets:startWork` para escribir en `.nest/`):

```ts
ipcMain.handle('notion:specToWorktree', async (_e, args: { pageId: string; worktreePath: string }) => {
  const { pageId, worktreePath } = args ?? {}
  if (typeof pageId !== 'string' || typeof worktreePath !== 'string') return { ok: false as const, error: 'BAD_ARGS' }
  if (!worktreeStore.get(worktreePath) || !existsSync(worktreePath)) return { ok: false as const, error: 'NO_WORKTREE' }
  try {
    const md = await fetchPageMarkdown(panelDeps(), pageId)
    mkdirSync(join(worktreePath, '.nest'), { recursive: true })
    writeFileSync(join(worktreePath, '.nest', 'spec.md'), md)
    return { ok: true as const, prompt: md }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : 'error' }
  }
})
```

(Importar `fetchPageMarkdown` de `./integrations/notion`.)

- [ ] **Step 2:** `preload.ts` — `window.notion`: `contextBridge.exposeInMainWorld('notion', { specToWorktree: (pageId, worktreePath) => ipcRenderer.invoke('notion:specToWorktree', { pageId, worktreePath }) })`. Tipo en `src/types.ts`.

- [ ] **Step 3:** `IntegrationPanelShell.tsx` — prop opcional `onWorkOnDoc?: (pageId: string, title: string) => void`. En el `ip-detail-row` (línea ~148, junto a las actions), si `onWorkOnDoc && selected` renderizar un botón:

```tsx
{onWorkOnDoc && detail && (
  <button className="ip-action ip-action-primary" onClick={() => onWorkOnDoc(detail.ref.itemId, detail.title)}>
    Work on this
  </button>
)}
```

- [ ] **Step 4:** `MyReposPanel.tsx` — donde monta `<IntegrationPanelShell>` (~línea 450), pasar `onWorkOnDoc` SOLO cuando el plugin es `notion`. La impl del callback: `worktree.create({ repoPath: activeRepoPath, branch })` (branch derivado del título con `tickets.branchName('', pageId.slice(0,6), title)` o un slug), luego `window.notion.specToWorktree(pageId, res.meta.repoPath)`, luego `onOpenWorktree(res.meta.repoPath)` con el `prompt` como `initialInput` (misma cadena que `MyTicketsView.workOn` — leé ese archivo y replicá el patrón; el `initialInput` viaja por el estado `addingPane` que H4 ya extendió).

- [ ] **Step 5:** Verify: `npx vitest run` (verde) + typecheck web excluyendo `demoMode.ts` (crear `tsconfig.tmp.json` en scratchpad que extienda `tsconfig.web.json` con `"exclude": ["src/lib/demoMode.ts"]` y correr `npx tsc --noEmit -p <tmp>` — ver nota de H4 sobre demoMode). Confirmar sin errores nuevos en los archivos tocados.

- [ ] **Step 6: Commit** `git commit -m "feat(h5): Notion 'Work on this' → spec.md + prompt inicial del agente"`

---

## Self-Review (hecho)
- **Spec coverage:** notify por evento (Task 3) · emisión changes/review (Tasks 1-2) · setPresence (Task 4) · Notion spec→worktree (Tasks 6-7). ✅
- **Placeholders:** los tests traen código; los detalles de UI (Task 7 Step 4) referencian `MyTicketsView.workOn` como patrón a replicar (archivo real, no placeholder).
- **Type consistency:** `changes.requested`/`review.requested` (definidos en H4) usados con los mismos campos; `SetPresenceCommand` guard alineado; `notify` channel-desde-config coherente entre receta (channel:'') y handler.
- **Nota:** el clear de `setPresence` en `session.closed` queda follow-up (nadie emite ese evento hoy).
