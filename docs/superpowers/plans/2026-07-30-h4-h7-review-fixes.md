# H4-H7 — Fixes del review adversario — Implementation Plan

> **For agentic workers:** TDD estricto por fix: test que REPRODUCE el bug (RED) → fix (GREEN) → commit. Steps con checkbox `- [ ]`.

**Goal:** Arreglar los bugs reales que 3 reviews adversarios (correctness, silent-failure, cobertura) encontraron en H4-H7. Cada uno es un bug confirmado con impacto de usuario, no un nitpick.

**Contexto:** rama `feat/integrations`, 477 tests verde. Los fixes tocan `worktree-signals.ts`, `ticket-loop.ts`, `bus-commands.ts`, `slack-socket.ts`, `slack-envelopes.ts`, `main.ts` y sus tests. Specs/planes en `docs/superpowers/`.

**Orden:** P1 (1-6) sí o sí; P2 (7-8) baratos. Cada fix con su test.

---

## Fix 1 — `ci.failed` se emite aunque el branch esté verde (worktree-signals)

**Bug** (`worktree-signals.ts:68,88-97`): `failedRun = runs.find(r => completed && FAILED)` mira los últimos 5 runs; el emit no está gateado por el estado ACTUAL. Commit A falla → pusheás B que pasa → `ci='success'` (badge verde) pero `failedRun=A` → emite `ci.failed` → Slack dice "🔴 CI rojo" para un branch verde, y `runId/runUrl` apuntan al run viejo.

- [ ] **Test (RED)** en `worktree-signals.test.ts`:
```ts
it('NO emite ci.failed ni marca runId si el run más reciente está verde (aunque haya uno viejo rojo)', async () => {
  const deps = depsWith(async (url) => {
    if (url.includes('/actions/runs')) return new Response(JSON.stringify({ workflow_runs: [
      { id: 2, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'b', head_branch: 'feat/x', head_sha: 'B' },
      { id: 1, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'a', head_branch: 'feat/x', head_sha: 'A' },
    ] }), { status: 200 })
    return new Response('[]', { status: 200 })
  })
  const emit = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
  const s = new WorktreeSignals(() => 'acme/app'); s.attachBus({ emit } as never)
  await s.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
  expect(s.get('/wt/x')?.ci).toBe('success')
  expect(s.get('/wt/x')?.runId).toBeUndefined()
  expect(emit.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(0)
})
```
- [ ] **Fix (GREEN):** en `pollOne`, derivar el run rojo del estado actual: `const failedRun = ci === 'failure' ? runs[0] : undefined`. El resto (dedup por sha, emit) queda igual pero ahora solo corre cuando el HEAD actual está rojo.
- [ ] Verificá que el test existente de dedup (mismo SHA) sigue verde. **Commit** `fix(h4): ci.failed solo cuando el run actual del branch está rojo`

---

## Fix 2 — `review.requested` colisiona entre repos por número de PR (worktree-signals)

**Bug** (`worktree-signals.ts:~32,115`): `reviewNotified: Set<number>` por `it.number`. Los números de PR no son globales; `acme/app#5` y `acme/other#5` chocan → el segundo review request nunca se emite. **Confirmado por 2 reviewers.**

- [ ] **Test (RED):**
```ts
it('review.requested no colisiona entre repos con el mismo número de PR', async () => {
  const items = [
    { number: 5, title: 'A', repository_url: 'https://api.github.com/repos/acme/app' },
    { number: 5, title: 'B', repository_url: 'https://api.github.com/repos/acme/other' },
  ]
  const deps = depsWith(async (url) => url.includes('/search/issues')
    ? new Response(JSON.stringify({ items }), { status: 200 }) : new Response('[]', { status: 200 }))
  const emit = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
  const s = new WorktreeSignals(() => 'acme/app'); s.attachBus({ emit } as never)
  await s.pollReviewRequests(deps)
  expect(emit.mock.calls.filter(c => (c[0] as { type: string }).type === 'review.requested')).toHaveLength(2)
})
```
- [ ] **Fix:** `reviewNotified` pasa a `Set<string>`; la key es `` `${repoFullName}#${it.number}` `` (armar `repoFullName` desde `it.repository_url` ANTES del `.has`). **Commit** `fix(h5): dedup de review.requested por repo+número (no colisiona entre repos)`

---

## Fix 3 — `onPrStateChanged` destrackea cuando `updateStatus` fue no-op (ticket-loop + bus-commands)

**Bug** (`bus-commands.ts:79-82` + `ticket-loop.ts:~237`): `handleUpdateStatus` con `!provider` hace `console.warn + return` (no-op SIN throw). El comando no cae en `failed[]` → `statusFailed=false` → `onPrStateChanged` destrackea en `merged` aunque la transición NUNCA ocurrió. Rompe la paridad que el fix `4239328` buscaba (el path sin-bus SÍ conserva el tracking ante provider ausente).

- [ ] **Test (RED)** en `ticket-loop.test.ts` (bloque con bus): un handler updateStatus que NO transiciona (provider ausente) → el tracking debe sobrevivir en merged.
```ts
it('con bus, si updateStatus es no-op por provider ausente el tracking sobrevive (no stuck)', async () => {
  // provider resolver que devuelve null → handleUpdateStatus no-opea
  const loopNoProv = new TicketLoop()
  const bus2 = new EventBus()
  bus2.setRecipes(defaultRecipes((b) => loopNoProv.trackedTicket(b)))
  registerBusCommands(bus2, { ticketLoop: { providerFor: () => null } })
  loopNoProv.attachBus(bus2)
  // trackear a mano (sin startWork, que necesitaría provider)
  ;(loopNoProv as unknown as { tracked: Map<string, unknown> }).tracked.set('gero/PROJ-1-fix',
    { pluginId: 'jira', providerId: 'p1', key: 'PROJ-1', repoFullName: 'acme/app' })
  await loopNoProv.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
  expect(loopNoProv.trackedTicket('gero/PROJ-1-fix')).toBeDefined() // no destrackeado
})
```
- [ ] **Fix:** en `handleUpdateStatus` (`bus-commands.ts`), cuando `!provider`, **tirar** en vez de no-opear: `throw new Error('updateStatus: provider ausente ' + cmd.pluginId)`. Así cae en `failed[]` → `statusFailed=true` → el loop conserva el tracking y reintenta (paridad con H3). El resto de handlers (notify/logOutcome/setPresence) SIGUEN degradando a no-op sin throw (son best-effort de verdad; updateStatus es la transición, no es best-effort). **Commit** `fix(h4): updateStatus tira ante provider ausente para no destrackear un ticket sin transicionar`

---

## Fix 4 — un blip de GitHub pisa el último estado bueno de CI/review (worktree-signals)

**Bug** (`worktree-signals.ts:43-49,62-87`): `gh()` colapsa 401/403/429/5xx/timeout a `null`, indistinguible de "sin data". `pollOne` hace `state.set(...)` incondicional: un worktree rojo que sufre un blip queda pisado a `{ci:'unknown', runId:undefined}` → el badge rojo desaparece y `fixCiPrompt` devuelve null hasta el próximo poll OK.

- [ ] **Test (RED):**
```ts
it('un fallo transitorio del fetch de runs NO pisa el estado rojo previo', async () => {
  let firstRun = true
  const deps = depsWith(async (url) => {
    if (url.includes('/actions/runs')) {
      if (firstRun) { firstRun = false; return new Response(JSON.stringify({ workflow_runs: [
        { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: 'S' } ] }), { status: 200 }) }
      return new Response('boom', { status: 500 }) // blip
    }
    return new Response('[]', { status: 200 })
  })
  const s = new WorktreeSignals(() => 'acme/app')
  const wts = [{ repoPath: '/wt/x', branch: 'feat/x' }]
  await s.poll(wts, deps)                     // rojo
  expect(s.get('/wt/x')?.ci).toBe('failure')
  await s.poll(wts, deps)                     // blip 500
  expect(s.get('/wt/x')?.ci).toBe('failure')  // retiene el estado bueno
  expect(s.get('/wt/x')?.runId).toBe(9)
})
```
- [ ] **Fix:** que `gh()` distinga fallo de vacío. Opción mínima: en `pollOne`, si `runsJson === null` (gh falló) **retornar temprano sin tocar `state`** (retener el signal previo). Para el request de `reviews`: si devolvió null, conservar el `changesRequested` previo en vez de asumir false. (Documentá que 401 persistente deja el estado viejo — el push de "reconectá GitHub" al renderer queda como follow-up.) **Commit** `fix(h4): un blip de GitHub no borra el estado de CI/review previo del worktree`

---

## Fix 5 — el Slack socket muere para siempre si un `connect()` de reconexión tira (slack-socket)

**Bug** (`slack-socket.ts:91-96`): `onClose → void connect().catch(warn)`. Si `connect()` rechaza (fetch falla, `apps.connections.open` !ok/429), no se crea ws nuevo → no hay `close` → la cadena de reconexión queda muerta hasta reiniciar. Sin backoff, además, un ciclo rápido de close martilla `apps.connections.open`. **Confirmado por 2 reviewers.**

- [ ] **Test (RED)** en `slack-socket.test.ts` (con `vi.useFakeTimers()`):
```ts
it('si connect() falla, reintenta con backoff (no queda muerto)', async () => {
  vi.useFakeTimers()
  let calls = 0
  const fetch = vi.fn(async () => { calls++; if (calls === 1) throw new Error('net'); 
    return new Response(JSON.stringify({ ok: true, url: 'wss://x' }), { status: 200 }) })
  const ws = fakeWs()
  const sock = new SlackSocket({ appToken: 'x', fetch: fetch as never, wsFactory: () => ws, onAppMention: vi.fn(), onBlockAction: vi.fn() })
  await sock.connect().catch(() => {})   // 1er intento falla
  await vi.advanceTimersByTimeAsync(5000) // backoff dispara reintento
  expect(calls).toBeGreaterThanOrEqual(2)
  sock.disconnect(); vi.useRealTimers()
})
```
- [ ] **Fix:** extraer `scheduleReconnect()` que hace `setTimeout(() => void this.connect().catch(() => this.scheduleReconnect()), this.backoff)` con backoff exponencial (p.ej. `min(30_000, base*2^n)`) + reset al conectar OK. `connect()` en su `catch` propio llama `scheduleReconnect()`. `onClose` llama `scheduleReconnect()` (no `connect()` directo). `disconnect()` limpia el timer (`clearTimeout`) y set `stopped`. Guardá el timer en un campo. **Commit** `fix(h7): reconexión del socket con backoff que sobrevive a connect() fallido`

---

## Fix 6 — el retry re-emite side-effects (notify/logOutcome) duplicados cada ciclo (ticket-loop)

**Bug** (`ticket-loop.ts:~226-245` + recetas H5/H6): ante un 500 transitorio de Jira, el tracking se conserva (correcto) pero el próximo poll re-emite `pr.merged` → notify y logOutcome (que nunca tiran) se re-disparan → mensaje Slack + evento Calendar nuevos cada 90s hasta que el provider se recupere.

- [ ] **Test (RED):** dos ciclos merged con updateStatus fallando → notify NO debe dispararse dos veces (el side-effect es una vez; la transición reintenta).
```ts
it('con bus, un merged que reintenta la transición NO re-dispara notify cada ciclo', async () => {
  // provider.transition falla siempre; contamos cuántas veces se dispara notify
  const notifyCalls: unknown[] = []
  const prov = makeProvider(); (prov.transition as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('500'))
  const loop3 = new TicketLoop(); loop3.register('jira', () => prov)
  const bus3 = new EventBus(); bus3.setRecipes(defaultRecipes((b) => loop3.trackedTicket(b)))
  bus3.registerHandler('updateStatus', async (c) => { if (c.cmd==='updateStatus') await prov.transition(c.providerId, c.to) })
  bus3.registerHandler('notify', async () => { notifyCalls.push(1) })
  loop3.attachBus(bus3)
  await loop3.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never, 'acme/app')
  await loop3.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never) // 1er merged
  await loop3.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never) // retry
  expect(notifyCalls.length).toBeLessThanOrEqual(1)
})
```
- [ ] **Fix:** agregar un flag `merged?: true` al `Tracked`. En `onPrStateChanged(merged)` con bus: si `!t.merged` → emitir por el bus (side-effects incluidos) UNA vez; si `updateStatus` OK → destrackear; si falló → conservar con `{...t, merged: true}`. Si `t.merged` ya es true (retry) → **NO** re-emitir por el bus; reintentar SOLO la transición directa (`provider.transition(providerId,'done')`, path H3), y destrackear solo si tiene éxito. Así el notify/logOutcome salen una vez y la transición reintenta sin ruido.
- [ ] **Además** (idempotencia de Calendar): en `gcal.ts createOutcomeEvent`, setear `extendedProperties.private.taskId = <ref>` para que `findEventByTask` lo encuentre en un futuro y haga `appendOutcome` en vez de duplicar. **Commit** `fix(h5/h6): el retry de la transición no re-dispara notify/logOutcome (side-effects una vez)`

---

## Fix 7 — `block_actions` sin fallback de `ts` (slack-envelopes)

**Bug** (`slack-envelopes.ts:~84`): el mention path hace `threadTs: ev.thread_ts ?? ev.ts ?? ''` pero el action path solo lee `payload.message?.thread_ts`. En un botón sobre un mensaje top-level, `threadTs` queda `undefined` → `slack:postThread` no-opea.

- [ ] **Test (RED):** block_actions con `message.ts` pero sin `thread_ts` → `threadTs` cae al `ts`.
- [ ] **Fix:** `threadTs: payload.message?.thread_ts ?? payload.message?.ts ?? ''`. **Commit** `fix(h7): block_actions cae al ts del mensaje cuando no hay thread_ts`

---

## Fuera de este lote (documentar, no bloquean)
- **gcal `invalid_grant`** (silent-hunter #E): el refresh traga el error terminal y deja la UI "conectada". Fix ideal: detectar `invalid_grant` → limpiar creds + push "reconectá Calendar". **Follow-up** (necesita el canal de estado al renderer, mismo que "reconectá GitHub" del Fix 4).
- **Dedup en memoria no persiste** → spam de `ci.failed`/`review.requested` tras cada reinicio. **Follow-up** (persistir `ciNotified`/`reviewNotified`, o aceptar el ruido de arranque).
- **Test de render del badge** (test-analyzer #6): badge verde no-clickeable. Follow-up (setup jsdom ya existe; bajo riesgo).

## Al terminar
`npx vitest run` verde (debería subir de 477). `git log --oneline` con los 7 commits. Reportá desviaciones, sobre todo en Fix 3 y Fix 6 (interacciones sutiles del retry).
