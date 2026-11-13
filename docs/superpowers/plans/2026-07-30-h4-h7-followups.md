# H4-H7 — Follow-ups (sin credenciales) — Implementation Plan

> **For agentic workers:** TDD estricto. Test que reproduce/verifica → código → commit. Steps con checkbox.

**Goal:** Cerrar los follow-ups documentados del review y los gaps de test de resiliencia, todo sin credenciales reales (mocks). Rama `feat/integrations`, suite 485 verde.

**Contexto:** referencias en `docs/superpowers/plans/2026-07-30-h4-h7-review-fixes.md` (§Fuera de este lote) y el análisis de cobertura del review.

---

## FU-1 — Persistir el dedup de señales (anti-spam tras reinicio)

**Problema:** `ciNotified`/`reviewNotified` viven solo en memoria (`worktree-signals.ts`); tras reiniciar la app se re-emiten `ci.failed`/`review.requested` de todo lo que siga rojo/pendiente → spam de notificaciones.

**Files:** `electron/integrations/worktree-signals.ts`, `electron/__tests__/worktree-signals.test.ts`, wiring en `electron/main.ts`.

- [ ] **Test (RED):** dos instancias de `WorktreeSignals` compartiendo el mismo archivo de storage; la 2ª (restart) NO re-emite `ci.failed` para un SHA ya notificado por la 1ª.
```ts
it('el dedup de ci.failed persiste entre reinicios (no spamea al arrancar)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wsig-')); const file = join(dir, 'signals.json')
  try {
    const rojo = () => new Response(JSON.stringify({ workflow_runs: [
      { id: 9, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'r', head_branch: 'feat/x', head_sha: 'S' } ] }), { status: 200 })
    const deps = depsWith(async (u) => u.includes('/actions/runs') ? rojo() : new Response('[]', { status: 200 }))
    const emit1 = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
    const s1 = new WorktreeSignals(() => 'acme/app'); s1.attachStorage(file); s1.attachBus({ emit: emit1 } as never)
    await s1.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps)
    expect(emit1.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(1)
    const emit2 = vi.fn(async (_e: unknown, _d: unknown) => ({ commands: [], failed: [] }))
    const s2 = new WorktreeSignals(() => 'acme/app'); s2.attachStorage(file); s2.attachBus({ emit: emit2 } as never)
    await s2.poll([{ repoPath: '/wt/x', branch: 'feat/x' }], deps) // restart, mismo SHA rojo
    expect(emit2.mock.calls.filter(c => (c[0] as { type: string }).type === 'ci.failed')).toHaveLength(0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
```
- [ ] **Impl:** `attachStorage(filePath)` en `WorktreeSignals` (patrón de `ticket-loop.ts attachStorage/saveTracked`): carga `{ ciNotified: Record<repoPath,sha>, reviewNotified: string[] }` al adjuntar, y persiste (best-effort, tmp+rename) cada vez que se agrega a `ciNotified`/`reviewNotified`. En `main.ts`, `worktreeSignals.attachStorage(pathJoin(ravenHome(), '.raven-nest', 'worktree-signals.json'))` junto al wiring existente.
- [ ] **Commit** `fix(h4): persistir el dedup de señales para no spamear notificaciones tras reiniciar`

---

## FU-2 — Blip del fetch de `pulls` no borra changesRequested/prNumber

**Problema** (`worktree-signals.ts:82-95`): si el fetch de `pulls` devuelve `null` (blip), `pr` queda undefined → `prNumber`/`changesRequested` se van a undefined/false, pisando el estado previo. Fix 4 cubrió `runs` y `reviews`, no `pulls`.

- [ ] **Test (RED):** worktree con `changesRequested:true`+`prNumber` → poll con `pulls`→500 → conserva ambos.
- [ ] **Impl:** en `pollOne`, distinguir `pulls === null` (blip) de `[]` (sin PR): si `pulls === null`, conservar `prNumber`/`changesRequested` previos en el `state.set` (o retornar temprano tras haber calculado CI, conservando el resto del signal previo). Preservar el `ci` recién calculado (runs sí anduvo).
- [ ] **Commit** `fix(h4): un blip del fetch de PRs no borra el chip changes-requested`

---

## FU-3 — gcal `invalid_grant` limpia las creds muertas

**Problema** (`main.ts refreshGcalIfNeeded` ~2318): un `invalid_grant` (refresh token revocado/expirado) se traga con warn y deja las creds zombie en `pluginCreds('gcal')`; la UI sigue "conectada" pero el Calendar queda vacío para siempre.

**Files:** `electron/integrations/gcal-oauth.ts` (marcar el error terminal), `electron/main.ts`, tests.

- [ ] **Test (RED)** en `gcal-oauth.test.ts`: `refreshAccessToken` con `{ error: 'invalid_grant' }` (400) tira un error identificable (p.ej. una clase `GcalAuthError` o un error con `.terminal = true`), distinto de un 500 transitorio.
- [ ] **Impl:** en `refreshAccessToken`, si `json.error === 'invalid_grant'` (o 400 con ese error), tirar un error marcado como terminal. En `main.ts refreshGcalIfNeeded`, capturar: si es terminal → `pluginCreds.deleteToken('gcal')` (o setToken vacío) para que la UI deje de mostrarlo conectado; si es transitorio (5xx/red) → mantener y warn (como hoy). (El push "reconectá Calendar" al renderer queda para la pasada de UI en vivo; lo crítico —no dejar creds zombie— se cierra acá.)
- [ ] **Commit** `fix(h6): invalid_grant limpia las creds de Calendar (no dejar la integración zombie)`

---

## FU-4 — Tests de resiliencia (gaps del review de cobertura)

Solo tests, sin cambios de producción (verifican garantías ya implementadas). Un archivo/commit por área.

- [ ] **slack-socket** (`slack-socket.test.ts`):
  - Frame no-JSON (`{ data: 'garbage' }`) → no tira, no ACKea, no dispatcha.
  - Envelope de control `disconnect` entrante → el socket llama `close` y reconecta (`fetch` 2 veces; con fake timers por el backoff).
  - ACK se envía aunque `onAppMention` tire (el handler que lanza no impide el ACK).
- [ ] **worktree-signals** (`worktree-signals.test.ts`):
  - `ci.failed` SÍ re-emite ante un SHA rojo NUEVO (rojo shaA → rojo shaB = 2 emisiones).
  - `changes.requested` re-emite tras reset (CHANGES_REQUESTED → APPROVED → CHANGES_REQUESTED = 2 emisiones).
- [ ] **gcal-oauth** (`gcal-oauth.test.ts`):
  - `refreshAccessToken` con `res` no-ok (500) tira (path de error transitorio), simétrico al de `exchangeCode`.
- [ ] **Commit(s)** `test(h4/h6/h7): cubrir resiliencia — frame malformado, disconnect entrante, re-emit por SHA/reset, refresh error`

---

## FU-5 — Test de render del badge de CI

**Problema:** `WorktreesSection` badge no tiene test; contrato no trivial (verde NO clickeable, failure clickea `onFixCi`, chip changes solo si `changesRequested`).

**Files:** `src/components/__tests__/WorktreesSection-ci-badge.test.tsx` (nuevo), siguiendo el patrón jsdom existente (`Sidebar-integrations.test.tsx`).

- [ ] **Test:** mockear `useWorktreeSignals` (o `window.signals`) para devolver un worktree con `ci:'failure'` y otro `ci:'success'`; renderizar `WorktreesSection` con props mínimas (incl. `onFixCi`); afirmar:
  - badge `failure` presente y clickeable → dispara `onFixCi(repoPath)`.
  - badge `success` presente pero SIN handler de click (no dispara `onFixCi`).
  - `ci:'unknown'` → sin badge.
  - `changesRequested:true` → chip presente.
- [ ] **Commit** `test(h4): render del badge de CI (verde no-clickeable, failure clickea onFixCi, chip changes)`

---

## Al terminar
`npx vitest run` verde (sube de 485). `git log --oneline`. Reportá qué quedó hecho y cualquier follow-up que no se pudo cerrar sin credenciales/testeo en vivo (esperado: el push de estado "reconectá X" al renderer + su UI, que se valida en vivo).
