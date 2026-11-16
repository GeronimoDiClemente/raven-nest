# Cifrado obligatorio al conectar la nube — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que ninguna fila personal llegue al servidor de sync en claro, ni desde Nest ni desde el plugin `@nestmux/memory`: conectar la nube activa (o adopta) el cifrado en el mismo paso.

**Architecture:** el servidor rechaza toda fila personal sin sellar y reporta cuánto sigue en claro (`plaintext_pending`). El daemon exige la maestra antes de cualquier push (`requireEncryption`). Un orquestador puro, `asegurarCifrado`, decide adoptar / activar / esperar y lo usan igual el main de Nest y el `login` de la CLI. La UI muestra el código de recuperación, la espera de autorización o el botón para activar.

**Tech Stack:** TypeScript, Node `pg` + vitest (server, Postgres real en Docker), Electron main + better-sqlite3 + vitest (electron), React + Testing Library (renderer), Playwright (e2e contra `dist/`).

**Spec:** `docs/superpowers/specs/2026-11-02-cifrado-obligatorio-design.md`

## Global Constraints

- Rama `feat/memories-settings`, worktree `.claude/worktrees/memory-smoke`. Commits sin push.
- Typecheck real = los DOS comandos de CI: `npx tsc -p tsconfig.node.json --noEmit --composite false` y `npx tsc -p tsconfig.web.json --noEmit --composite false` (baseline: 0 errores). Server: `cd server && npx tsc --noEmit -p tsconfig.json`.
- Tests electron/renderer: `npm run native:node` antes (binding de Node para better-sqlite3); `npx vitest run <archivo>`.
- Tests server: Postgres `nest-memory-pg` arriba (`docker start nest-memory-pg`, puerto 55432); `cd server && npx vitest run <archivo>`.
- Toda la UI, los textos de CLI y los datos de prueba visibles en **inglés**. Comentarios de código en español, como el resto del repo.
- Prefijo de sobre: `nmc1:`. Campos sellados: `title`, `content`, `project_display_name`, `content_hash`, `origin_account`, `git_branch` + `tags` como un único sobre.
- El código de recuperación nunca se escribe a disco ni a logs.
- Ningún comando toca prod (Railway, Supabase prod, npm). `release.yml` y `build.yml` no se corren.
- e2e siempre headless y después de `npm run build`.

## Review Focus

1. **Sin red al conectar** (estado remoto ilegible): no se activa a ciegas — una activación desde una máquina que no ve la época real rota la clave de las demás. Esperado: `sin-estado`, nada publicado, sync bloqueado. → test en Task 6.
2. **Dos máquinas activan a la vez** una cuenta nueva: la que pierde recibe `409 stale_key_epoch` y tiene que ADOPTAR, nunca quedar sin clave ni crear otra. → test en Task 6.
3. **El tick del intervalo antes de que termine el connect**: el daemon ya corre desde el arranque y puede pushear apenas existe el token. Esperado: nada sale sin maestra. → test en Task 5.
4. **Cuenta vieja con memoria en claro y filas que sólo existen en el servidor**: `plaintext_pending` nunca llega a 0 por el re-upload local. Esperado: el re-upload automático corre UNA vez por sesión, no en cada status. → test en Task 7.
5. **El usuario cambia de pestaña con el código sin confirmar**: el código sigue disponible desde el main (`pendingRecoveryCode`) y, si se perdió (reinicio), se puede regenerar. → tests en Tasks 3, 6 y 8.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `server/src/push.ts` (mod) | Rechazo de claro personal sin depender de la época; `git_branch` sellado |
| `server/vitest.config.ts` (mod) | `ALLOW_PLAINTEXT_PERSONAL=1` sólo para tests |
| `server/src/status.ts` (mod) | `plaintext_pending` |
| `server/src/keys.ts` (mod) | Modo `recovery` de `publishWraps` |
| `electron/memory-envelope.ts` (mod) | Sellar y abrir `git_branch` |
| `electron/memory-daemon.ts` (mod) | `requireEncryption`, `needs_encryption_setup`, `plaintext_pending` |
| `electron/memory-keys-client.ts` (mod) | `regenerateRecoveryCode` |
| `electron/asegurar-cifrado.ts` (nuevo) | Orquestador puro adoptar / activar / esperar |
| `electron/main.ts`, `electron/preload.ts`, `src/types.ts` (mod) | Cableado e IPC nuevos |
| `src/hooks/useMemory.ts`, `src/components/CloudMemoryCard.tsx`, `src/components/MemoryEncryptionCard.tsx`, `src/components/memories/RecoveryCodeBlock.tsx` (nuevo) | UI |
| `electron/enrolamiento-del-paquete.ts`, `electron/enrolamiento-desde-login.ts`, `electron/cli-del-paquete.ts`, `electron/daemon-del-paquete.ts` (mod) | CLI |
| `e2e/12-cifrado-dos-maquinas.spec.ts` (mod) | Flujo nuevo de dos máquinas |

---

### Task 1: Servidor — ninguna fila personal en claro, `git_branch` incluido

**Files:**
- Modify: `server/src/push.ts` (constante `CAMPOS_SELLADOS` ~línea 174; bloque `cuentaCifra` y el rechazo `encryption_required` agregados en el commit `276148b`)
- Modify: `server/vitest.config.ts`
- Test: `server/__tests__/push-personal-encryption.test.ts`

**Interfaces:**
- Produces: rechazo `encryption_required` para toda fila `scope !== 'team'` con un campo sellable en claro, salvo `process.env.ALLOW_PLAINTEXT_PERSONAL === '1'` con `key_epoch = 0`.

- [ ] **Step 1: Cambiar los tests**

En `server/__tests__/push-personal-encryption.test.ts`, reemplazar el test `'una cuenta que NO cifra sigue subiendo en claro'` por estos tres, y agregar el import de `afterEach`:

```ts
describe('sin ALLOW_PLAINTEXT_PERSONAL (producción)', () => {
  const antes = process.env.ALLOW_PLAINTEXT_PERSONAL
  beforeEach(() => { delete process.env.ALLOW_PLAINTEXT_PERSONAL })
  afterEach(() => { if (antes === undefined) delete process.env.ALLOW_PLAINTEXT_PERSONAL; else process.env.ALLOW_PLAINTEXT_PERSONAL = antes })

  it('una cuenta que NO cifra (época 0) tampoco puede subir en claro', async () => {
    const res = await handlePush(pool, noCifra, { mutations: [mutation(5, SYNC('epoca-0'))] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
  })

  it('git_branch en claro cuenta como texto en claro', async () => {
    const res = await handlePush(pool, cifra, { mutations: [mutation(7, SYNC('rama'), { ...SELLADA, git_branch: 'feat/adquisicion-x' })] })
    expect(res.results[0]).toMatchObject({ outcome: 'rejected', error: 'encryption_required' })
  })
})

it('con ALLOW_PLAINTEXT_PERSONAL=1 (sólo tests) una cuenta en época 0 sube en claro', async () => {
  expect(process.env.ALLOW_PLAINTEXT_PERSONAL).toBe('1')
  const res = await handlePush(pool, noCifra, { mutations: [mutation(8, SYNC('permitido'))] })
  expect(res.results[0]).toMatchObject({ outcome: 'applied' })
})
```

Import: `import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'`.

- [ ] **Step 2: Correr y ver fallar**

Run: `cd server && npx vitest run __tests__/push-personal-encryption.test.ts`
Expected: FAIL — `época 0` aplica en vez de rechazar; `git_branch` aplica; el de `ALLOW_PLAINTEXT_PERSONAL` falla en `toBe('1')`.

- [ ] **Step 3: Implementar**

`server/vitest.config.ts`, dentro de `test`:

```ts
    /**
     * El servidor rechaza toda fila personal en claro (spec 2026-11-02, cifrado obligatorio).
     * 24 archivos de tests suben filas en claro para probar OTRAS cosas (cuota, tope, pull,
     * supersede); esto los deja seguir haciéndolo. En producción esta variable no existe.
     */
    env: { ALLOW_PLAINTEXT_PERSONAL: '1' },
```

`server/src/push.ts`:

```ts
const CAMPOS_SELLADOS = ['title', 'content', 'project_display_name', 'content_hash', 'origin_account', 'git_branch'] as const
```

Reemplazar `const cuentaCifra = Number(epochRows[0]?.key_epoch ?? 0) > 0` por:

```ts
    // Spec 2026-11-02: ninguna fila personal en claro, cifre la cuenta o no. La única salida
    // es `ALLOW_PLAINTEXT_PERSONAL=1` con la cuenta en época 0, que sólo setea el vitest del
    // servidor: con la cuenta ya cifrando, ni los tests pueden subir claro.
    const cuentaCifra = Number(epochRows[0]?.key_epoch ?? 0) > 0
    const exigeSellado = cuentaCifra || process.env.ALLOW_PLAINTEXT_PERSONAL !== '1'
```

y en el rechazo cambiar `cuentaCifra` por `exigeSellado`:

```ts
      if (scope !== 'team' && exigeSellado && !viajaSellado(p)) {
```

Actualizar el comentario del rechazo: "Toda fila personal (spec 2026-11-02, cifrado obligatorio)…".

- [ ] **Step 4: Correr los tests del archivo y el suite entero**

Run: `cd server && npx vitest run __tests__/push-personal-encryption.test.ts && npx vitest run`
Expected: PASS; suite completo 61 archivos verdes (los que suben claro siguen andando por la env var). Si `push-team-encryption.test.ts` falla por `git_branch` en una fila "sellada" de prueba: esas filas no traen `git_branch`, no debería; si alguna lo trae en claro, sellarla en el fixture (`git_branch: 'nmc1:GGGG'`).

- [ ] **Step 5: Typecheck y commit**

```bash
cd server && npx tsc --noEmit -p tsconfig.json && cd ..
git add server/src/push.ts server/vitest.config.ts server/__tests__/push-personal-encryption.test.ts
git commit -m "fix(cifrado): el servidor no acepta ninguna fila personal en claro

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Servidor — `plaintext_pending` en el status

**Files:**
- Modify: `server/src/status.ts` (interface `StatusResponse` ~línea 62, `handleStatus` ~líneas 94-137)
- Test: `server/__tests__/status-plaintext-pending.test.ts` (nuevo)

**Interfaces:**
- Produces: `StatusResponse.plaintext_pending: number` — observaciones propias, no borradas, `scope <> 'team'`, con algún campo sellable en claro.

- [ ] **Step 1: Test que falla**

```ts
// Spec 2026-11-02 §4: cuánto sigue en claro en la nube, para que el cliente sepa si la
// migración terminó. Una fila re-subida sellada con el mismo sync_id deja de contar.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { handlePush } from '../src/push'
import { handleStatus } from '../src/status'

const pool = getPool()
const RUN = randomUUID().slice(0, 8)
let auth: { deviceId: string; userId: string; plan: string }
const proj = `spp-${RUN}`

const SELLADA = {
  title: 'nmc1:AAAA', content: 'nmc1:BBBB', tags: ['nmc1:CCCC'],
  project_display_name: 'nmc1:DDDD', content_hash: 'nmc1:EEEE', origin_account: 'nmc1:FFFF', git_branch: 'nmc1:GGGG',
}
function mutation(seq: number, syncId: string, scope: string, extra: Record<string, unknown> = {}, op: 'upsert' | 'delete' = 'upsert') {
  return {
    seq, sync_id: syncId, op,
    payload: {
      sync_id: syncId, project_key: proj, project_display_name: proj, scope,
      type: 'decision', topic_key: null, title: 'plain title', content: 'plain body',
      tags: [], lamport: seq, updated_at: Date.now(), created_at: Date.now(), ...extra,
    },
  }
}

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  auth = { deviceId, userId, plan: 'cloud' }
})
afterAll(async () => { await pool.end() })

describe('status — plaintext_pending', () => {
  it('cuenta las filas personales en claro y deja de contarlas al re-subirlas selladas', async () => {
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(0)
    await handlePush(pool, auth, { mutations: [mutation(1, `${RUN}-a`, 'personal'), mutation(2, `${RUN}-b`, 'personal')] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(2)

    await handlePush(pool, auth, { mutations: [mutation(3, `${RUN}-a`, 'personal', SELLADA)] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(1)
  })

  it('no cuenta filas de equipo ni borradas', async () => {
    const antes = (await handleStatus(pool, auth)).plaintext_pending
    await handlePush(pool, auth, { mutations: [mutation(4, `${RUN}-borrada`, 'personal')] })
    await handlePush(pool, auth, { mutations: [mutation(5, `${RUN}-borrada`, 'personal', { title: '', content: null }, 'delete')] })
    expect((await handleStatus(pool, auth)).plaintext_pending).toBe(antes)
  })
})
```

- [ ] **Step 2: Ver fallar**

Run: `cd server && npx vitest run __tests__/status-plaintext-pending.test.ts`
Expected: FAIL — `plaintext_pending` es `undefined`.

- [ ] **Step 3: Implementar**

En la interface `StatusResponse`, después de `encrypted_teams`:

```ts
  /**
   * Spec 2026-11-02 §4: cuántas observaciones propias, personales y vivas siguen con algún
   * campo de texto en claro en la nube. El cliente no dice "Encrypted" hasta que esto es 0.
   */
  plaintext_pending: number
```

En `handleStatus`, antes del `return`:

```ts
  // `p.user_id = $1` es lo que impide contar filas ajenas. Las de equipo las cubre la
  // migración de equipo (`recrypt-pending`), no esto.
  const { rows: claroRows } = await pool.query(
    `select count(*)::int as n
       from observations o join projects p on p.id = o.project_id
      where p.user_id = $1 and o.scope <> 'team' and not o.deleted and (
            (coalesce(o.title, '') <> '' and o.title not like 'nmc1:%')
         or (coalesce(o.content, '') <> '' and o.content not like 'nmc1:%')
         or (coalesce(o.content_hash, '') <> '' and o.content_hash not like 'nmc1:%')
         or (coalesce(o.origin_account, '') <> '' and o.origin_account not like 'nmc1:%')
         or (coalesce(o.git_branch, '') <> '' and o.git_branch not like 'nmc1:%')
         or (jsonb_typeof(o.tags) = 'array' and jsonb_array_length(o.tags) > 0
             and not (jsonb_array_length(o.tags) = 1 and o.tags->>0 like 'nmc1:%')))`,
    [auth.userId]
  )
```

y en el objeto devuelto: `plaintext_pending: Number(claroRows[0]?.n ?? 0),`

- [ ] **Step 4: Tests**

Run: `cd server && npx vitest run __tests__/status-plaintext-pending.test.ts && npx vitest run`
Expected: PASS, suite verde. Si algún test compara el status entero con `toEqual`, agregarle `plaintext_pending: expect.any(Number)`.

- [ ] **Step 5: Commit**

```bash
cd server && npx tsc --noEmit -p tsconfig.json && cd ..
git add server/src/status.ts server/__tests__/status-plaintext-pending.test.ts
git commit -m "feat(sync): el status informa cuánto sigue en claro en la nube

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Servidor + cliente de claves — regenerar el código de recuperación

**Files:**
- Modify: `server/src/keys.ts` (`publishWraps`, chequeo de `mode` ~línea 244, después del bloque `if (modo === 'authorize') {…}` ~línea 416)
- Modify: `electron/memory-keys-client.ts`
- Test: `server/__tests__/keys-recovery-mode.test.ts` (nuevo), `electron/__tests__/memory-keys-client-recovery.test.ts` (nuevo)

**Interfaces:**
- Produces (server): `POST /v1/keys/publish` con `mode: 'recovery'`: exactamente un wrap `{slot:'recovery', kind:'recovery'}`, `key_epoch === actual > 0`, `rotate_proof` válido. Errores: 400 `invalid_recovery_wrap`, 409 `not_activated` / `stale_key_epoch`, 403 `must_hold_master`.
- Produces (cliente): `regenerateRecoveryCode(deps: KeysClientDeps, master: string, keyEpoch: number): Promise<string>` — devuelve el código nuevo.

- [ ] **Step 1: Test del servidor**

```ts
// Spec 2026-11-02, "Errores y bordes": regenerar el código de recuperación sin rotar la
// maestra. Sólo toca el slot `recovery` y exige probar la maestra vigente.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getPool, migrate } from '../src/db'
import { publishWraps } from '../src/keys'

const pool = getPool()
let auth: { userId: string; deviceId: string }

beforeAll(async () => {
  await migrate(pool)
  const userId = randomUUID()
  const deviceId = randomUUID()
  await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [userId])
  await pool.query(`insert into devices (id, user_id, name, token_hash) values ($1, $2, 'd', $3)`, [deviceId, userId, `hash-${deviceId}`])
  auth = { userId, deviceId }
  const r = await publishWraps(pool, auth, {
    key_epoch: 1, mode: 'activate', rotate_verifier: 'verif-1',
    wraps: [
      { slot: deviceId, kind: 'device', wrapped: 'dev-wrap' },
      { slot: 'recovery', kind: 'recovery', wrapped: 'rec-viejo', wrap_meta: { salt: 's1' } },
    ],
  })
  expect(r.ok).toBe(true)
})
afterAll(async () => { await pool.end() })

const nuevo = { slot: 'recovery', kind: 'recovery' as const, wrapped: 'rec-nuevo', wrap_meta: { salt: 's2' } }
async function slots() {
  const { rows } = await pool.query('select slot, wrapped from key_wraps where user_id = $1 order by slot', [auth.userId])
  return Object.fromEntries(rows.map((r) => [r.slot, r.wrapped]))
}

describe('publishWraps — modo recovery', () => {
  it('sin la prueba de la maestra: 403 y nada cambia', async () => {
    const r = await publishWraps(pool, auth, { key_epoch: 1, mode: 'recovery', rotate_proof: 'otra', wraps: [nuevo] })
    expect(r).toMatchObject({ ok: false, status: 403, error: 'must_hold_master' })
    expect((await slots()).recovery).toBe('rec-viejo')
  })

  it('con otra época: 409', async () => {
    const r = await publishWraps(pool, auth, { key_epoch: 2, mode: 'recovery', rotate_proof: 'verif-1', wraps: [nuevo] })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'stale_key_epoch' })
  })

  it('un wrap que no es el de recuperación: 400', async () => {
    const r = await publishWraps(pool, auth, {
      key_epoch: 1, mode: 'recovery', rotate_proof: 'verif-1',
      wraps: [{ slot: auth.deviceId, kind: 'device', wrapped: 'x' }],
    })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'invalid_recovery_wrap' })
  })

  it('con la prueba: reemplaza SÓLO el slot recovery, sin rotar', async () => {
    const r = await publishWraps(pool, auth, { key_epoch: 1, mode: 'recovery', rotate_proof: 'verif-1', wraps: [nuevo] })
    expect(r).toEqual({ ok: true, keyEpoch: 1 })
    expect(await slots()).toEqual({ [auth.deviceId]: 'dev-wrap', recovery: 'rec-nuevo' })
    const { rows } = await pool.query('select key_epoch from users where id = $1', [auth.userId])
    expect(Number(rows[0].key_epoch)).toBe(1)
  })

  it('una cuenta sin cifrado: 409 not_activated', async () => {
    const otro = { userId: randomUUID(), deviceId: randomUUID() }
    await pool.query(`insert into users (id, plan) values ($1, 'cloud')`, [otro.userId])
    const r = await publishWraps(pool, otro, { key_epoch: 1, mode: 'recovery', rotate_proof: 'x', wraps: [nuevo] })
    expect(r).toMatchObject({ ok: false, status: 409, error: 'not_activated' })
  })
})
```

- [ ] **Step 2: Ver fallar**

Run: `cd server && npx vitest run __tests__/keys-recovery-mode.test.ts`
Expected: FAIL — 400 `invalid_mode` en todos.

- [ ] **Step 3: Implementar en el servidor**

Cambiar el chequeo de modo:

```ts
    if (body?.mode !== 'activate' && body?.mode !== 'authorize' && body?.mode !== 'recovery') {
```

Inmediatamente después de `const modo = body.mode`:

```ts
    /**
     * Spec 2026-11-02: regenerar el código de recuperación sin rotar. Un solo wrap, el de
     * recuperación; la época vigente; y la prueba de la maestra — sin ella cualquier device
     * de la cuenta pisaría la copia de recuperación con una que no abre nada (el motivo de
     * `cannot_overwrite_recovery` en `authorize`).
     */
    if (modo === 'recovery') {
      const unico = wraps.length === 1 ? wraps[0] : null
      if (!unico || unico.slot !== 'recovery' || unico.kind !== 'recovery') {
        await client.query('rollback')
        return { ok: false, status: 400, error: 'invalid_recovery_wrap' }
      }
      if (keyEpoch !== actual || actual === 0) {
        await client.query('rollback')
        return { ok: false, status: 409, error: actual === 0 ? 'not_activated' : 'stale_key_epoch' }
      }
    }
```

Y después del bloque `if (modo === 'authorize') { … }`:

```ts
    if (modo === 'recovery' && !(await pruebaDePosesion())) {
      await client.query('rollback')
      return { ok: false, status: 403, error: 'must_hold_master' }
    }
```

(El insert final ya hace upsert del slot y, con `keyEpoch === actual`, no borra nada.)

- [ ] **Step 4: Tests del servidor**

Run: `cd server && npx vitest run __tests__/keys-recovery-mode.test.ts __tests__/keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Test del cliente**

`electron/__tests__/memory-keys-client-recovery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { regenerateRecoveryCode } from '../memory-keys-client'
import { generateMasterKey, rotateVerifier } from '../memory-crypto'
import { unwrapWithRecovery } from '../memory-key-wrap'

describe('regenerateRecoveryCode', () => {
  it('publica en modo recovery un wrap que abre con el código devuelto, con la prueba de la maestra', async () => {
    const master = generateMasterKey()
    let cuerpo: Record<string, any> = {}
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      cuerpo = JSON.parse(String(init?.body))
      return { ok: true, status: 200, json: async () => ({ ok: true, keyEpoch: 3 }) } as unknown as Response
    }) as unknown as typeof fetch
    const codigo = await regenerateRecoveryCode(
      { baseUrl: 'http://sync.test', token: 't', deviceId: 'd', fetchImpl }, master.toString('base64'), 3)

    expect(cuerpo.mode).toBe('recovery')
    expect(cuerpo.key_epoch).toBe(3)
    expect(cuerpo.rotate_proof).toBe(rotateVerifier(master, 3))
    expect(cuerpo.wraps).toHaveLength(1)
    expect(cuerpo.wraps[0]).toMatchObject({ slot: 'recovery', kind: 'recovery' })
    const abierta = unwrapWithRecovery(codigo, { wrapped: cuerpo.wraps[0].wrapped, salt: cuerpo.wraps[0].wrap_meta.salt })
    expect(abierta.equals(master)).toBe(true)
  })
})
```

Run: `npm run native:node && npx vitest run electron/__tests__/memory-keys-client-recovery.test.ts`
Expected: FAIL — `regenerateRecoveryCode` no existe.

- [ ] **Step 6: Implementar en el cliente**

En `electron/memory-keys-client.ts`, después de `authorizeDevice`:

```ts
/**
 * Spec 2026-11-02: un código de recuperación nuevo para la MISMA maestra (sin rotar). El
 * anterior deja de servir: el servidor reemplaza el slot `recovery`. Como `activateEncryption`,
 * el código se devuelve para mostrarlo una vez y no se guarda en ningún lado.
 */
export async function regenerateRecoveryCode(
  deps: KeysClientDeps,
  master: string,
  keyEpoch: number
): Promise<string> {
  const maestra = Buffer.from(master, 'base64')
  const recoveryCode = generateRecoveryCode()
  const recovery = wrapForRecovery(recoveryCode, maestra)
  await pedir(deps, '/v1/keys/publish', {
    method: 'POST',
    body: {
      key_epoch: keyEpoch,
      mode: 'recovery',
      rotate_proof: rotateVerifier(maestra, keyEpoch),
      wraps: [{ slot: 'recovery', kind: 'recovery', wrapped: recovery.wrapped, wrap_meta: { salt: recovery.salt } }],
    },
  })
  return recoveryCode
}
```

- [ ] **Step 7: Tests y commit**

Run: `npx vitest run electron/__tests__/memory-keys-client-recovery.test.ts electron/__tests__/memory-keys-client.test.ts`
Expected: PASS.

```bash
cd server && npx tsc --noEmit -p tsconfig.json && cd ..
npx tsc -p tsconfig.node.json --noEmit --composite false
git add server/src/keys.ts server/__tests__/keys-recovery-mode.test.ts electron/memory-keys-client.ts electron/__tests__/memory-keys-client-recovery.test.ts
git commit -m "feat(cifrado): regenerar el código de recuperación sin rotar la maestra

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sobre — sellar y abrir `git_branch`

**Files:**
- Modify: `electron/memory-envelope.ts` (`SEALED_FIELDS` línea 40; `openPulledRow` ~línea 162-170)
- Test: `electron/__tests__/memory-envelope-git-branch.test.ts` (nuevo)

**Interfaces:**
- Consumes: `PulledRow.gitBranch?: string` (`electron/memory-daemon.ts:157`).
- Produces: `sealMutationPayload` sella `git_branch`; `openPulledRow` abre `gitBranch`.

- [ ] **Step 1: Test que falla**

```ts
import { describe, it, expect } from 'vitest'
import { sealMutationPayload, openPulledRow } from '../memory-envelope'
import { deriveKeys, generateMasterKey, isCiphertext } from '../memory-crypto'
import type { PulledRow } from '../memory-daemon'

const ctx = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }

describe('git_branch viaja sellado', () => {
  it('se sella al subir y se abre al bajar', () => {
    const sellado = sealMutationPayload(ctx, {
      sync_id: 's1', project_key: 'p', scope: 'personal', title: 't', content: 'c', git_branch: 'feat/secreto',
    })
    expect(isCiphertext(String(sellado.git_branch))).toBe(true)

    const fila = {
      syncId: 's1', projectKey: 'p', scope: 'personal', type: 'decision', title: sellado.title as string,
      content: sellado.content as string, gitBranch: sellado.git_branch as string, tags: [],
    } as unknown as PulledRow
    const { row, undecryptable } = openPulledRow(ctx, fila)
    expect(undecryptable).toBe(false)
    expect(row.gitBranch).toBe('feat/secreto')
  })

  it('una rama ausente o null se respeta', () => {
    const sellado = sealMutationPayload(ctx, { sync_id: 's2', project_key: 'p', scope: 'personal', title: 't', git_branch: null })
    expect(sellado.git_branch).toBeNull()
  })
})
```

Run: `npx vitest run electron/__tests__/memory-envelope-git-branch.test.ts`
Expected: FAIL — `git_branch` sale en claro.

- [ ] **Step 2: Implementar**

```ts
const SEALED_FIELDS = ['title', 'content', 'project_display_name', 'content_hash', 'origin_account', 'git_branch'] as const
```

Sumar al comentario de arriba de `SEALED_FIELDS`: "`git_branch` (spec 2026-11-02): un nombre de rama dice de qué se trata el trabajo; el servidor sólo lo guarda."

En `openPulledRow`, después del bloque de `originAccount`:

```ts
  if (row.gitBranch !== undefined) {
    abierto.gitBranch = abrir(row.gitBranch, 'git_branch') ?? undefined
  }
```

- [ ] **Step 3: Tests y commit**

Run: `npx vitest run electron/__tests__/memory-envelope-git-branch.test.ts electron/__tests__/memory-envelope.test.ts`
Expected: PASS. Si `memory-envelope.test.ts` tiene un test que fija la lista de campos sellados contra los abiertos, ya incluye el nuevo por construcción; si compara contra una lista literal, sumarle `'git_branch'`.

```bash
git add electron/memory-envelope.ts electron/__tests__/memory-envelope-git-branch.test.ts
git commit -m "fix(cifrado): la rama de git viaja sellada

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Daemon — `requireEncryption`, `needs_encryption_setup` y `plaintext_pending`

**Files:**
- Modify: `electron/memory-daemon.ts` (`MemoryDaemonDeps` ~línea 180-195; `StatusResponseBody` ~línea 108; gate en `doPush` ~líneas 858-884; `doStatus` ~línea 1398)
- Test: `electron/__tests__/memory-daemon-require-encryption.test.ts` (nuevo)

**Interfaces:**
- Produces:
  - `MemoryDaemonDeps.requireEncryption?: () => boolean`
  - `MemoryDaemonDeps.onPlaintextPending?: (n: number) => void` — se llama en cada status con `plaintext_pending > 0`.
  - `MemoryDaemon.getPlaintextPending(): number | null`
  - detalle de estado `'needs_encryption_setup'` (con `status = 'error'`).

- [ ] **Step 1: Test que falla**

```ts
// Spec 2026-11-02 §2: con `requireEncryption`, sin maestra no sale NADA — tampoco por el
// tick del intervalo, que corre desde el arranque y puede adelantarse al connect.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'
import { deriveKeys, generateMasterKey } from '../memory-crypto'
import type { EnvelopeContext } from '../memory-envelope'

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-require-enc-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { vi.useRealTimers(); store.close(); rmSync(dir, { recursive: true, force: true }) })

function servidor(keyEpoch: number, plaintextPending = 0) {
  const subidas: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    if (String(url).includes('/status')) {
      return ok({ device_id: 'dev', user_id: 'u', plan: 'cloud', next_poll_ms: 300_000,
        quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: [], key_epoch: keyEpoch, plaintext_pending: plaintextPending })
    }
    if (String(url).includes('/pull')) return ok({ rows: [], cursors: {} })
    const body = JSON.parse(String(init?.body ?? '{}')) as { mutations?: Array<{ sync_id: string; payload: Record<string, unknown> }> }
    for (const m of body.mutations ?? []) subidas.push(m.payload)
    return ok({ results: (body.mutations ?? []).map((m) => ({ sync_id: m.sync_id, outcome: 'applied', project_seq: 1 })) })
  }) as unknown as typeof fetch
  return { fetchImpl, subidas }
}

function daemon(fetchImpl: typeof fetch, ctx: () => EnvelopeContext | null, extra: Record<string, unknown> = {}) {
  return new MemoryDaemon({
    store, getSyncBaseUrl: () => 'http://sync.test', getToken: () => 'tok', getDeviceId: () => 'dev',
    isOnline: () => true, fetchImpl, getEnvelopeContext: ctx,
    isEncryptionExpected: () => store.knownKeyEpoch() > 0,
    requireEncryption: () => true,
    ...extra,
  })
}
const guardar = () => store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'secret', content: 'body', source: 'mcp' })

describe('requireEncryption', () => {
  it('época 0 y sin maestra: no sale nada y el estado es needs_encryption_setup', async () => {
    guardar()
    const srv = servidor(0)
    const d = daemon(srv.fetchImpl, () => null)
    await d.push()
    expect(srv.subidas).toEqual([])
    expect(d.getStatus()).toBe('error')
    expect(d.getStatusDetail()).toBe('needs_encryption_setup')
    expect(store.pendingMutationCount()).toBe(1)
  })

  it('época > 0 y sin maestra: needs_key, como antes', async () => {
    guardar()
    const srv = servidor(2)
    const d = daemon(srv.fetchImpl, () => null)
    await d.push()
    expect(srv.subidas).toEqual([])
    expect(d.getStatusDetail()).toBe('needs_key')
  })

  it('el tick del intervalo tampoco sube sin maestra', async () => {
    vi.useFakeTimers()
    guardar()
    const srv = servidor(0)
    const d = daemon(srv.fetchImpl, () => null)
    d.start()
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    d.stop()
    expect(srv.subidas).toEqual([])
  })

  it('con la maestra sale SELLADO', async () => {
    guardar()
    const srv = servidor(1)
    const ctx: EnvelopeContext = { keys: deriveKeys(generateMasterKey()), keyEpoch: 1 }
    await daemon(srv.fetchImpl, () => ctx).push()
    expect(srv.subidas).toHaveLength(1)
    expect(String(srv.subidas[0].title).startsWith('nmc1:')).toBe(true)
  })

  it('sin requireEncryption (callers viejos) el comportamiento no cambia', async () => {
    guardar()
    const srv = servidor(0)
    await daemon(srv.fetchImpl, () => null, { requireEncryption: undefined }).push()
    expect(srv.subidas).toHaveLength(1)
  })
})

describe('plaintext_pending', () => {
  it('se guarda del status y avisa cuando es > 0', async () => {
    const avisos: number[] = []
    const d = daemon(servidor(1, 7).fetchImpl, () => null, { onPlaintextPending: (n: number) => avisos.push(n) })
    expect(d.getPlaintextPending()).toBeNull()
    await d.status()
    expect(d.getPlaintextPending()).toBe(7)
    expect(avisos).toEqual([7])
  })

  it('con 0 no avisa', async () => {
    const avisos: number[] = []
    const d = daemon(servidor(1, 0).fetchImpl, () => null, { onPlaintextPending: (n: number) => avisos.push(n) })
    await d.status()
    expect(d.getPlaintextPending()).toBe(0)
    expect(avisos).toEqual([])
  })
})
```

Run: `npm run native:node && npx vitest run electron/__tests__/memory-daemon-require-encryption.test.ts`
Expected: FAIL — sube en claro en época 0; `getPlaintextPending` no existe.

- [ ] **Step 2: Implementar**

En `MemoryDaemonDeps`, después de `isEncryptionExpected`:

```ts
  /**
   * Spec 2026-11-02: la cuenta TIENE que cifrar, aunque todavía no lo haga (época 0). Con
   * esto, sin maestra no sale nada: `needs_encryption_setup` en época 0, `needs_key` si la
   * cuenta ya cifra. La app y el paquete lo pasan siempre en `true`; sin la dep, nada cambia.
   */
  requireEncryption?: () => boolean
  /** Spec 2026-11-02 §4: el status dijo que hay filas propias en claro en la nube. */
  onPlaintextPending?: (n: number) => void
```

En `StatusResponseBody`:

```ts
  /** Spec 2026-11-02: filas propias que siguen en claro en la nube. Ausente = servicio viejo. */
  plaintext_pending?: number
```

Campo privado junto a `lastLimits`: `private lastPlaintextPending: number | null = null`, y en `setStore` resetearlo: `this.lastPlaintextPending = null`.

Getter junto a `getQuota()`:

```ts
  /** Spec 2026-11-02: lo último que informó el servidor; `null` hasta el primer status. */
  getPlaintextPending(): number | null {
    return this.lastPlaintextPending
  }
```

Gate en `doPush`. La condición de espera del primer status pasa a incluir la dep nueva:

```ts
    if (!this.primerStatusOk && (this.deps.isEncryptionExpected || this.deps.requireEncryption || hayDeEquipo)) {
```

y reemplazar el bloque de `seEsperaCifrado` por:

```ts
    const seEsperaCifrado = this.deps.isEncryptionExpected?.() ?? false
    const seExigeCifrado = this.deps.requireEncryption?.() ?? false
    const contexto = this.deps.getEnvelopeContext?.() ?? null
    if (seEsperaCifrado && (!contexto || contexto.keyEpoch < store.knownKeyEpoch())) {
      this.setStatus('error', 'needs_key')
      return
    }
    // Spec 2026-11-02: la cuenta todavía no cifra, pero conectar exige cifrar. Sin maestra no
    // sale nada; la UI ofrece "Turn on encryption".
    if (seExigeCifrado && !contexto) {
      this.setStatus('error', 'needs_encryption_setup')
      return
    }
```

En `doStatus`, justo después de `this.primerStatusOk = true`:

```ts
      if (typeof body.plaintext_pending === 'number') {
        this.lastPlaintextPending = body.plaintext_pending
        if (body.plaintext_pending > 0) this.deps.onPlaintextPending?.(body.plaintext_pending)
      }
```

- [ ] **Step 3: Tests**

Run: `npx vitest run electron/__tests__/memory-daemon-require-encryption.test.ts electron/__tests__/memory-daemon-encryption-required.test.ts electron/__tests__/memory-daemon-cifrado-push.test.ts electron/__tests__/memory-daemon-cifrado-equipo.test.ts`
Expected: PASS. Si el test del intervalo no dispara el drain, revisar `INTERVAL_MS` y avanzar el reloj a más que ese valor.

- [ ] **Step 4: Commit**

```bash
npx tsc -p tsconfig.node.json --noEmit --composite false
git add electron/memory-daemon.ts electron/__tests__/memory-daemon-require-encryption.test.ts
git commit -m "feat(cifrado): el daemon no sube nada sin la maestra cuando el cifrado es obligatorio

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `asegurarCifrado` — el orquestador compartido

**Files:**
- Create: `electron/asegurar-cifrado.ts`
- Test: `electron/__tests__/asegurar-cifrado.test.ts`

**Interfaces:**
- Consumes: `adoptExistingKey`, `fetchKeyState`, `activateEncryption`, `KeysHttpError` (`memory-keys-client.ts`); `DeviceKeyPair` (`memory-key-wrap.ts`).
- Produces:

```ts
export type ResultadoDeAsegurar =
  | { estado: 'lista'; master: string; keyEpoch: number; nueva: boolean }
  | { estado: 'activada'; master: string; keyEpoch: number; recoveryCode: string }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }

export interface DepsDeAsegurar {
  material: () => { device: DeviceKeyPair; master: string | null; keyEpoch: number }
  adoptar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number } | null>
  estadoRemoto: () => Promise<{ keyEpoch: number }>
  activar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number; recoveryCode: string }>
  huella: (publicKey: string) => string
}

export async function asegurarCifrado(d: DepsDeAsegurar): Promise<ResultadoDeAsegurar>
```

`nueva: true` cuando la maestra se adoptó en esta llamada (el llamador la guarda); `false` cuando ya la tenía.

- [ ] **Step 1: Test que falla**

```ts
// Spec 2026-11-02 §3: adoptar primero, activar sólo con época 0 LEÍDA, nunca a ciegas.
import { describe, it, expect, vi } from 'vitest'
import { asegurarCifrado, type DepsDeAsegurar } from '../asegurar-cifrado'
import { KeysHttpError } from '../memory-keys-client'

const device = { publicKey: 'pub', privateKey: 'priv' }
function deps(over: Partial<DepsDeAsegurar> = {}): DepsDeAsegurar {
  return {
    material: () => ({ device, master: null, keyEpoch: 0 }),
    adoptar: vi.fn(async () => null),
    estadoRemoto: vi.fn(async () => ({ keyEpoch: 0 })),
    activar: vi.fn(async () => ({ master: 'M', keyEpoch: 1, recoveryCode: 'CODE' })),
    huella: () => 'HUELLA',
    ...over,
  }
}

describe('asegurarCifrado', () => {
  it('con la maestra vigente ya en la máquina: lista, sin adoptar ni activar', async () => {
    const d = deps({ material: () => ({ device, master: 'M', keyEpoch: 2 }), estadoRemoto: vi.fn(async () => ({ keyEpoch: 2 })) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'M', keyEpoch: 2, nueva: false })
    expect(d.adoptar).not.toHaveBeenCalled()
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('cuenta que ya cifra y envoltura publicada: adopta', async () => {
    const d = deps({ adoptar: vi.fn(async () => ({ master: 'M', keyEpoch: 3 })), estadoRemoto: vi.fn(async () => ({ keyEpoch: 3 })) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'M', keyEpoch: 3, nueva: true })
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('cuenta que ya cifra sin envoltura para esta máquina: espera con la huella, nunca activa', async () => {
    const d = deps({ estadoRemoto: vi.fn(async () => ({ keyEpoch: 3 })) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('época 0 leída: activa y devuelve el código', async () => {
    expect(await asegurarCifrado(deps())).toEqual({ estado: 'activada', master: 'M', keyEpoch: 1, recoveryCode: 'CODE' })
  })

  it('sin red al leer el estado: sin-estado, sin activar', async () => {
    const d = deps({ estadoRemoto: vi.fn(async () => { throw new Error('fetch failed') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'sin-estado', detalle: 'fetch failed' })
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('sin red al adoptar: sin-estado, sin activar', async () => {
    const d = deps({ adoptar: vi.fn(async () => { throw new Error('offline') }) })
    expect((await asegurarCifrado(d)).estado).toBe('sin-estado')
    expect(d.activar).not.toHaveBeenCalled()
  })

  it('otra máquina activó en el medio (409): adopta la que quedó', async () => {
    const adoptar = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ master: 'OTRA', keyEpoch: 1 })
    const d = deps({ adoptar, activar: vi.fn(async () => { throw new KeysHttpError(409, 'stale_key_epoch') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'lista', master: 'OTRA', keyEpoch: 1, nueva: true })
  })

  it('409 y todavía sin envoltura para esta máquina: espera', async () => {
    const d = deps({ activar: vi.fn(async () => { throw new KeysHttpError(409, 'stale_key_epoch') }) })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
  })

  it('maestra local de una época vieja: no cuenta como lista', async () => {
    const d = deps({
      material: () => ({ device, master: 'VIEJA', keyEpoch: 1 }),
      estadoRemoto: vi.fn(async () => ({ keyEpoch: 2 })),
    })
    expect(await asegurarCifrado(d)).toEqual({ estado: 'esperando-autorizacion', huella: 'HUELLA' })
  })
})
```

Run: `npx vitest run electron/__tests__/asegurar-cifrado.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 2: Implementar**

`electron/asegurar-cifrado.ts`:

```ts
// Spec 2026-11-02 §3 y §5: conectar la nube asegura la cuenta en el mismo paso. Lo usan igual
// el main de Nest (`memory:connect`, `memory:encryption:secure`) y el `login` del paquete.
//
// Puro: la red y el disco entran por `deps`. El que llama guarda la maestra.
//
// El orden es el contrato:
//   1. ¿Ya tengo la maestra de la época vigente? → lista.
//   2. Adoptar (de paso enrola la clave pública, así otra máquina me ve pendiente).
//   3. Sólo con la época 0 LEÍDA del servidor, activar. Sin red no se activa nunca: activar
//      desde una máquina que no ve la época real rota la clave de todas las demás.
//   4. Un 409 al activar es otra máquina que ganó la carrera: adoptar la suya.
import type { DeviceKeyPair } from './memory-key-wrap'
import { KeysHttpError } from './memory-keys-client'

export type ResultadoDeAsegurar =
  | { estado: 'lista'; master: string; keyEpoch: number; nueva: boolean }
  | { estado: 'activada'; master: string; keyEpoch: number; recoveryCode: string }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }

export interface DepsDeAsegurar {
  material: () => { device: DeviceKeyPair; master: string | null; keyEpoch: number }
  adoptar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number } | null>
  estadoRemoto: () => Promise<{ keyEpoch: number }>
  activar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number; recoveryCode: string }>
  huella: (publicKey: string) => string
}

const mensaje = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function asegurarCifrado(d: DepsDeAsegurar): Promise<ResultadoDeAsegurar> {
  const propio = d.material()
  const esperar = (): ResultadoDeAsegurar => ({ estado: 'esperando-autorizacion', huella: d.huella(propio.device.publicKey) })

  let remoto: { keyEpoch: number }
  try {
    remoto = await d.estadoRemoto()
  } catch (err) {
    return { estado: 'sin-estado', detalle: mensaje(err) }
  }

  if (propio.master && propio.keyEpoch === remoto.keyEpoch && remoto.keyEpoch > 0) {
    return { estado: 'lista', master: propio.master, keyEpoch: propio.keyEpoch, nueva: false }
  }

  try {
    const adoptada = await d.adoptar(propio.device)
    if (adoptada) return { estado: 'lista', ...adoptada, nueva: true }
  } catch (err) {
    return { estado: 'sin-estado', detalle: mensaje(err) }
  }

  if (remoto.keyEpoch > 0) return esperar()

  try {
    const activada = await d.activar(propio.device)
    return { estado: 'activada', ...activada }
  } catch (err) {
    if (err instanceof KeysHttpError && err.status === 409) {
      try {
        const adoptada = await d.adoptar(propio.device)
        return adoptada ? { estado: 'lista', ...adoptada, nueva: true } : esperar()
      } catch (err2) {
        return { estado: 'sin-estado', detalle: mensaje(err2) }
      }
    }
    return { estado: 'sin-estado', detalle: mensaje(err) }
  }
}
```

Nota de diseño: el estado remoto se lee ANTES de adoptar para poder distinguir "época vieja local" de "lista"; `adoptExistingKey` vuelve a leerlo por su cuenta — es una request extra aceptable en un flujo que corre una vez por connect.

- [ ] **Step 3: Tests y commit**

Run: `npx vitest run electron/__tests__/asegurar-cifrado.test.ts`
Expected: PASS (9 tests).

```bash
npx tsc -p tsconfig.node.json --noEmit --composite false
git add electron/asegurar-cifrado.ts electron/__tests__/asegurar-cifrado.test.ts
git commit -m "feat(cifrado): asegurarCifrado decide adoptar, activar o esperar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Main de Nest — conectar asegura, IPC nuevos, re-upload automático

**Files:**
- Modify: `electron/main.ts` (creación del daemon ~líneas 512-560; `memory:connect` ~3269-3311; handlers de cifrado ~3403-3578; `memory:status` ~3742)
- Modify: `electron/preload.ts` (~línea 100-107)
- Modify: `src/types.ts` (`window.memory`, ~líneas 1040-1120)
- Test: `electron/__tests__/conectar-sin-claro.test.ts` (nuevo)

**Interfaces:**
- Consumes: `asegurarCifrado`/`ResultadoDeAsegurar` (Task 6), `regenerateRecoveryCode` (Task 3), `requireEncryption`/`onPlaintextPending`/`getPlaintextPending` (Task 5), `runReencrypt` (`electron/memory-reencrypt.ts`).
- Produces (IPC y tipos del renderer):

```ts
type CifradoAlConectar =
  | { estado: 'lista' }
  | { estado: 'activada'; recoveryCode: string; aviso: string | null }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }
// memory:connect → { ok: true; itemCount: number; cifrado: CifradoAlConectar } | { ok: false; error }
// memory:encryption:secure → CifradoAlConectar
// memory:encryption:pendingRecoveryCode → string | null
// memory:encryption:confirmRecoveryCode → { ok: true }
// memory:encryption:regenerateRecoveryCode → { ok: true; recoveryCode: string } | { ok: false; error: string }
// memory:status suma → plaintextPending?: number
```

Preload: `encryptionSecure`, `encryptionPendingRecoveryCode`, `encryptionConfirmRecoveryCode`, `encryptionRegenerateRecoveryCode`.

- [ ] **Step 1: El test que importa (sin main)**

`electron/__tests__/conectar-sin-claro.test.ts` — arma `asegurarCifrado` + `MemoryDaemon` contra un servidor simulado que entiende `/v1/keys*` y `/v1/sync/*`, como lo cablea el main, y verifica que **nunca** llega una fila personal con un campo sellable en claro:

```ts
// Spec 2026-11-02: después de conectar una cuenta nueva, el servidor NUNCA recibe una fila
// personal con texto en claro. Arma lo mismo que `memory:connect`: el daemon ya corriendo
// (con su tick), la memoria local ya escrita, y asegurarCifrado + guardar la maestra.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MemoryStore } from '../memory-store'
import { MemoryDaemon } from '../memory-daemon'
import { asegurarCifrado } from '../asegurar-cifrado'
import { adoptExistingKey, activateEncryption, fetchKeyState } from '../memory-keys-client'
import { generateDeviceKeyPair, huellaDeClave } from '../memory-key-wrap'
import { deriveKeys } from '../memory-crypto'
import type { EnvelopeContext } from '../memory-envelope'

const SELLABLES = ['title', 'content', 'project_display_name', 'content_hash', 'origin_account', 'git_branch']
const enClaro = (p: Record<string, unknown>) =>
  SELLABLES.some((k) => typeof p[k] === 'string' && p[k] !== '' && !String(p[k]).startsWith('nmc1:'))
  || (Array.isArray(p.tags) && p.tags.length > 0 && !(p.tags.length === 1 && String(p.tags[0]).startsWith('nmc1:')))

let dir: string
let store: MemoryStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nest-conectar-sin-claro-'))
  store = new MemoryStore(join(dir, 'memory.db'))
  store.ensureProject({ projectKey: 'proj1', displayName: 'raven-nest' })
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

/** Un servicio de claves + sync en memoria: lo justo para activar y recibir pushes. */
function servicio() {
  const cuenta = { keyEpoch: 0, wraps: new Map<string, { wrapped: string; wrapMeta: unknown }>(), devices: new Map<string, string>() }
  const subidas: Array<Record<string, unknown>> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j } as unknown as Response)
    const u = String(url)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    if (u.endsWith('/v1/keys/enroll')) { cuenta.devices.set('dev', body.public_key); return ok({ ok: true }) }
    if (u.endsWith('/v1/keys/publish')) {
      if (body.mode === 'activate' && body.key_epoch !== cuenta.keyEpoch + 1) {
        return { ok: false, status: 409, json: async () => ({ error: 'stale_key_epoch' }) } as unknown as Response
      }
      cuenta.keyEpoch = body.key_epoch
      for (const w of body.wraps) cuenta.wraps.set(w.slot, { wrapped: w.wrapped, wrapMeta: w.wrap_meta ?? null })
      return ok({ ok: true, key_epoch: cuenta.keyEpoch })
    }
    if (u.includes('/v1/keys')) {
      return ok({ keyEpoch: cuenta.keyEpoch, wrap: cuenta.wraps.get('dev') ?? null,
        devices: [...cuenta.devices].map(([deviceId, publicKey]) => ({ deviceId, name: 'd', publicKey, hasWrap: cuenta.wraps.has(deviceId) })) })
    }
    if (u.includes('/status')) {
      return ok({ device_id: 'dev', user_id: 'u', plan: 'cloud', next_poll_ms: 300_000,
        quota: { used_bytes: 0, max_bytes: 1_000_000 }, projects: [], key_epoch: cuenta.keyEpoch, plaintext_pending: 0 })
    }
    if (u.includes('/pull')) return ok({ rows: [], cursors: {} })
    for (const m of body.mutations ?? []) subidas.push(m.payload)
    return ok({ results: (body.mutations ?? []).map((m: { sync_id: string }) => ({ sync_id: m.sync_id, outcome: 'applied', project_seq: 1 })) })
  }) as unknown as typeof fetch
  return { fetchImpl, subidas }
}

describe('conectar una cuenta nueva', () => {
  it('ninguna fila personal llega en claro, ni antes ni después de activar', async () => {
    const srv = servicio()
    const device = generateDeviceKeyPair()
    let ctx: EnvelopeContext | null = null
    const daemon = new MemoryDaemon({
      store, getSyncBaseUrl: () => 'http://sync.test', getToken: () => 'tok', getDeviceId: () => 'dev',
      isOnline: () => true, fetchImpl: srv.fetchImpl, getEnvelopeContext: () => ctx,
      isEncryptionExpected: () => store.knownKeyEpoch() > 0, requireEncryption: () => true,
    })

    // La memoria local ya existe y el daemon ya intenta subirla (el tick del arranque).
    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'secret plan', content: 'body', source: 'mcp' })
    await daemon.push()
    expect(srv.subidas).toEqual([])

    // memory:connect → asegurarCifrado → guardar la maestra (lo que hace el main).
    const kd = { baseUrl: 'http://sync.test', token: 'tok', deviceId: 'dev', fetchImpl: srv.fetchImpl }
    const r = await asegurarCifrado({
      material: () => ({ device, master: null, keyEpoch: 0 }),
      adoptar: (dv) => adoptExistingKey(kd, dv),
      estadoRemoto: () => fetchKeyState(kd),
      activar: (dv) => activateEncryption(kd, dv),
      huella: huellaDeClave,
    })
    expect(r.estado).toBe('activada')
    if (r.estado !== 'activada') return
    ctx = { keys: deriveKeys(Buffer.from(r.master, 'base64')), keyEpoch: r.keyEpoch }
    store.rememberKeyEpoch(r.keyEpoch)

    store.save({ projectKey: 'proj1', scope: 'personal', type: 'decision', title: 'second secret', content: 'more', source: 'mcp' })
    await daemon.push()

    expect(srv.subidas.length).toBeGreaterThan(0)
    expect(srv.subidas.filter(enClaro)).toEqual([])
  })
})
```

Run: `npx vitest run electron/__tests__/conectar-sin-claro.test.ts`
Expected: PASS ya con Tasks 5 y 6 (este test fija el contrato que el main tiene que respetar). Si falla, el cableado de las tasks anteriores está mal: arreglarlo antes de seguir.

- [ ] **Step 2: Estado nuevo en el main**

Cerca de `let memoryKeys` en `main.ts`:

```ts
/**
 * Spec 2026-11-02 §3: el código de recuperación de la última activación, hasta que el usuario
 * confirme que lo guardó. Sólo en memoria del proceso: nunca a disco ni a logs. Se pierde al
 * cerrar la app; para eso existe `memory:encryption:regenerateRecoveryCode`.
 */
let codigoDeRecuperacionPendiente: string | null = null
/** Spec 2026-11-02 §4: el re-upload automático corre UNA vez por sesión de la app. */
let reuploadAutomaticoHecho = false
```

- [ ] **Step 3: Cablear el daemon**

En el `new MemoryDaemon({...})` (~línea 512), junto a `isEncryptionExpected`:

```ts
    // Spec 2026-11-02: conectar la nube exige cifrar. Sin maestra no sale nada.
    requireEncryption: () => true,
    // Spec 2026-11-02 §4: una cuenta con memoria en claro en la nube, ya con la maestra en
    // esta máquina, re-sube todo sellado — una vez por sesión (ver `reuploadAutomaticoHecho`).
    onPlaintextPending: () => {
      if (reuploadAutomaticoHecho || !memoryKeys?.master || !memory) return
      reuploadAutomaticoHecho = true
      void runReencrypt(memory.store, memory.daemon).catch((err) => console.warn('[memory] re-upload automático', err))
    },
```

- [ ] **Step 4: `asegurarEnElMain()` y los handlers**

Función nueva antes de `memory:connect`:

```ts
type CifradoAlConectar =
  | { estado: 'lista' }
  | { estado: 'activada'; recoveryCode: string; aviso: string | null }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }

/** Spec 2026-11-02 §3: asegura la cuenta y deja la maestra guardada como los handlers de
 * adoptar/activar de abajo (misma secuencia: guardar, hasher, backfill, cursores, época). */
async function asegurarEnElMain(): Promise<CifradoAlConectar> {
  const deps = keysDeps()
  if (!deps || !memory) return { estado: 'sin-estado', detalle: 'Cloud memory is not connected.' }
  if (!memoryKeys) return { estado: 'sin-estado', detalle: 'This system cannot store keys securely.' }
  const r = await asegurarCifrado({
    material: () => ({ device: memoryKeys!.device, master: memoryKeys!.master ?? null, keyEpoch: memoryKeys!.keyEpoch ?? 0 }),
    adoptar: (device) => adoptExistingKey(deps, device),
    estadoRemoto: () => fetchKeyState(deps),
    activar: (device) => activateEncryption(deps, device),
    huella: huellaDeClave,
  })
  if (r.estado === 'esperando-autorizacion' || r.estado === 'sin-estado') return r
  if (r.estado === 'lista' && !r.nueva) return { estado: 'lista' }

  memoryKeys = { ...memoryKeys, master: r.master, keyEpoch: r.keyEpoch }
  let aviso: string | null = null
  try {
    saveKeyMaterial(ravenHome(), memory.store.getOwnerUserId(), safeStorage, memoryKeys)
  } catch (err) {
    aviso = 'Encryption is on, but the key could not be saved on this machine: ' +
      `${err instanceof Error ? err.message : String(err)}. Save the recovery code now — ` +
      'it is the only thing that will be able to recover your memories.'
  }
  applyTopicHasher()
  memory.store.backfillTopicHmacs()
  memory.store.rememberKeyEpoch(r.keyEpoch)
  if (r.estado === 'lista') {
    memory.store.resetPullCursors()
    memory.store.clearUndecryptable()
    return { estado: 'lista' }
  }
  codigoDeRecuperacionPendiente = r.recoveryCode
  return { estado: 'activada', recoveryCode: r.recoveryCode, aviso }
}
```

Imports al tope: `import { asegurarCifrado } from './asegurar-cifrado'` y sumar `regenerateRecoveryCode` al import de `./memory-keys-client`.

En `memory:connect`, reemplazar las dos últimas líneas:

```ts
  // Spec 2026-11-02: conectar asegura la cuenta en el mismo paso. Lo que protege es el gate
  // del daemon (`requireEncryption`): con o sin maestra, nada sale en claro.
  const cifrado = await asegurarEnElMain()
  memory.daemon.onNetworkRegain() // drains everything just seeded
  return { ok: true, itemCount: memory.store.count(), cifrado }
```

Handlers nuevos, después de `memory:encryption:reencrypt`:

```ts
// Spec 2026-11-02 §4: «Turn on encryption» de la tarjeta de Sync (cuentas viejas y reintento).
ipcMain.handle('memory:encryption:secure', async () => {
  const r = await asegurarEnElMain()
  if (r.estado === 'lista' || r.estado === 'activada') memory?.daemon.onNetworkRegain()
  return r
})

ipcMain.handle('memory:encryption:pendingRecoveryCode', () => codigoDeRecuperacionPendiente)

ipcMain.handle('memory:encryption:confirmRecoveryCode', () => {
  codigoDeRecuperacionPendiente = null
  return { ok: true }
})

ipcMain.handle('memory:encryption:regenerateRecoveryCode', async () => {
  const deps = keysDeps()
  if (!deps || !memoryKeys?.master) return { ok: false, error: 'This machine does not have the key.' }
  try {
    const recoveryCode = await regenerateRecoveryCode(deps, memoryKeys.master, memoryKeys.keyEpoch)
    codigoDeRecuperacionPendiente = recoveryCode
    return { ok: true, recoveryCode }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})
```

En `memory:status`, sumar al objeto: `plaintextPending: memory.daemon.getPlaintextPending() ?? undefined,`

- [ ] **Step 5: Preload y tipos**

`electron/preload.ts`, junto a `encryptionReencrypt`:

```ts
  encryptionSecure: () => ipcRenderer.invoke('memory:encryption:secure'),
  encryptionPendingRecoveryCode: () => ipcRenderer.invoke('memory:encryption:pendingRecoveryCode'),
  encryptionConfirmRecoveryCode: () => ipcRenderer.invoke('memory:encryption:confirmRecoveryCode'),
  encryptionRegenerateRecoveryCode: () => ipcRenderer.invoke('memory:encryption:regenerateRecoveryCode'),
```

`src/types.ts`: exportar el tipo arriba del bloque de `window.memory`:

```ts
/** Spec 2026-11-02: lo que devuelve conectar / «Turn on encryption». */
export type CifradoAlConectar =
  | { estado: 'lista' }
  | { estado: 'activada'; recoveryCode: string; aviso: string | null }
  | { estado: 'esperando-autorizacion'; huella: string }
  | { estado: 'sin-estado'; detalle: string }
```

Cambiar el tipo de `connect` para que el resultado ok incluya `cifrado?: CifradoAlConectar` (opcional: un main viejo no lo manda). Sumar a `status()`: `plaintextPending?: number`. Sumar los cuatro métodos, opcionales como el resto de los de cifrado:

```ts
      encryptionSecure?: () => Promise<CifradoAlConectar>
      encryptionPendingRecoveryCode?: () => Promise<string | null>
      encryptionConfirmRecoveryCode?: () => Promise<{ ok: true }>
      encryptionRegenerateRecoveryCode?: () => Promise<{ ok: true; recoveryCode: string } | { ok: false; error: string }>
```

Agregar `'needs_encryption_setup'` a la lista de códigos documentada en `daemonStatusDetail`.

- [ ] **Step 6: Typecheck, tests de cableado y commit**

Run:
```bash
npx tsc -p tsconfig.node.json --noEmit --composite false
npx tsc -p tsconfig.web.json --noEmit --composite false
npx vitest run electron/__tests__/conectar-sin-claro.test.ts electron/__tests__/memory-encryption-wiring.test.ts
```
Expected: 0 errores, PASS.

```bash
git add electron/main.ts electron/preload.ts src/types.ts electron/__tests__/conectar-sin-claro.test.ts
git commit -m "feat(cifrado): conectar la nube activa o adopta el cifrado en el mismo paso

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Renderer — código de recuperación, espera y «Turn on encryption»

**Files:**
- Create: `src/components/memories/RecoveryCodeBlock.tsx`
- Modify: `src/hooks/useMemory.ts` (estado + `connectWithToken`/`connectWithLogin` ~229-286, `refresh` ~92-146)
- Modify: `src/components/CloudMemoryCard.tsx`
- Modify: `src/components/MemoryEncryptionCard.tsx` (bloque del código ~134-150 pasa a usar `RecoveryCodeBlock`; botón de regenerar en el estado activo ~219-266)
- Test: `src/__tests__/components/CloudMemoryCard-cifrado.test.tsx` (nuevo), `src/__tests__/hooks/useMemory.test.tsx` (agregar casos)

**Interfaces:**
- Consumes: `CifradoAlConectar` y los métodos de Task 7.
- Produces:
  - `useMemory()` suma `cifrado: CifradoAlConectar | null`, `plaintextPending: number | null`, `secureEncryption(): Promise<void>`, `confirmRecoveryCode(): Promise<void>`.
  - `<RecoveryCodeBlock code aviso onDone />`.

- [ ] **Step 1: `RecoveryCodeBlock` (extraído de `MemoryEncryptionCard`)**

Leer el bloque actual de `MemoryEncryptionCard.tsx:134-150` y moverlo tal cual a:

```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * El código de recuperación, una vez. Lo usan la tarjeta de Sync (al conectar) y la de
 * Encryption. «Done» queda deshabilitado hasta tildar «I have saved it somewhere safe».
 */
export default function RecoveryCodeBlock({ code, aviso, onDone }: { code: string; aviso?: string | null; onDone: () => void }) {
  const [guardado, setGuardado] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warn/40 p-3">
      <p className="m-0 text-fs-sm font-medium text-foreground">Save this code</p>
      <p className="m-0 text-fs-sm text-muted-foreground">
        Save this recovery code. It's the only way back in if you lose every machine. We can't recover it for you.
      </p>
      <p className="m-0 select-all font-mono text-fs-md tracking-wide text-foreground">{code}</p>
      {aviso && <p className="m-0 text-fs-sm text-warn">{aviso}</p>}
      <label className="flex items-center gap-2 text-fs-sm text-foreground">
        <input type="checkbox" checked={guardado} onChange={(e) => setGuardado(e.target.checked)} />
        I have saved it somewhere safe
      </label>
      <Button size="sm" disabled={!guardado} onClick={onDone}>Done</Button>
    </div>
  )
}
```

Si las clases o el texto del bloque original difieren, conservar los del original (el e2e 12 busca "Save this code", la etiqueta y el botón "Done"). Reemplazar el bloque en `MemoryEncryptionCard` por `<RecoveryCodeBlock code={…} aviso={…} onDone={…} />` con los mismos handlers que tenía, y además llamar `window.memory.encryptionConfirmRecoveryCode?.()` en `onDone`.

Run: `npx vitest run src/__tests__/components/MemoryEncryptionCard.test.tsx`
Expected: PASS sin cambios en el test (mismo texto y mismo comportamiento).

- [ ] **Step 2: Tests de la tarjeta de Sync**

`src/__tests__/components/CloudMemoryCard-cifrado.test.tsx`. Seguir el armado de mocks de `src/__tests__/components/CloudMemoryCard.test.tsx` (copiar su `beforeEach` de `window.memory`, `useProfile` y `useUserRepos`) y agregar:

```tsx
it('al conectar una cuenta nueva muestra el código y Done exige el checkbox', async () => {
  api.connect.mockResolvedValue({ ok: true, itemCount: 3, cifrado: { estado: 'activada', recoveryCode: 'AAAA-BBBB', aviso: null } })
  render(<CloudMemoryCard />)
  fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
  expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument()
  const done = screen.getByRole('button', { name: 'Done' })
  expect(done).toBeDisabled()
  fireEvent.click(screen.getByLabelText('I have saved it somewhere safe'))
  fireEvent.click(done)
  await waitFor(() => expect(api.encryptionConfirmRecoveryCode).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('AAAA-BBBB')).toBeNull())
})

it('segunda máquina: muestra la huella y la espera', async () => {
  api.connect.mockResolvedValue({ ok: true, itemCount: 0, cifrado: { estado: 'esperando-autorizacion', huella: 'ab12 cd34' } })
  render(<CloudMemoryCard />)
  fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
  expect(await screen.findByText(/Approve this machine from one that already has the key/)).toBeInTheDocument()
  expect(screen.getByText('ab12 cd34')).toBeInTheDocument()
})

it('needs_encryption_setup: ofrece Turn on encryption, que llama a secure', async () => {
  api.status.mockResolvedValue({ ...statusConectado, daemonStatus: 'error', daemonStatusDetail: 'needs_encryption_setup' })
  api.encryptionSecure.mockResolvedValue({ estado: 'activada', recoveryCode: 'CCCC-DDDD', aviso: null })
  render(<CloudMemoryCard />)
  expect(await screen.findByText(/Cloud sync is paused until encryption is on/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Turn on encryption' }))
  expect(await screen.findByText('CCCC-DDDD')).toBeInTheDocument()
})

it('con plaintextPending > 0 dice cuánto falta', async () => {
  api.status.mockResolvedValue({ ...statusConectado, plaintextPending: 12 })
  render(<CloudMemoryCard />)
  expect(await screen.findByText('Encrypting your cloud memory… 12 left')).toBeInTheDocument()
})

it('al montar recupera un código pendiente del main (cambió de pestaña)', async () => {
  api.encryptionPendingRecoveryCode.mockResolvedValue('EEEE-FFFF')
  render(<CloudMemoryCard />)
  expect(await screen.findByText('EEEE-FFFF')).toBeInTheDocument()
})
```

con `api` sumando: `encryptionSecure: vi.fn()`, `encryptionConfirmRecoveryCode: vi.fn(async () => ({ ok: true }))`, `encryptionPendingRecoveryCode: vi.fn(async () => null)`, y `statusConectado` = el status conectado que ya usa el test existente.

Run: `npx vitest run src/__tests__/components/CloudMemoryCard-cifrado.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `useMemory`**

En `MemoryHookState` sumar:

```ts
  /** Spec 2026-11-02: el resultado de asegurar el cifrado al conectar (o de «Turn on»). */
  cifrado: CifradoAlConectar | null
  /** Filas propias que siguen en claro en la nube, según el servidor. */
  plaintextPending: number | null
```

Estado inicial: `cifrado: null, plaintextPending: null`. En `refresh`: `plaintextPending: status.plaintextPending ?? null`. Al montar (el `useEffect` que llama `refresh`), además:

```ts
    void api.encryptionPendingRecoveryCode?.().then((code) => {
      if (code) setState((s) => ({ ...s, cifrado: { estado: 'activada', recoveryCode: code, aviso: null } }))
    })
```

En `connectWithToken` y `connectWithLogin`, después de `if (!result.ok) throw …`:

```ts
      const cifrado = result.cifrado ?? null
      setState((s) => ({ ...s, cifrado }))
```

Funciones nuevas:

```ts
  const secureEncryption = useCallback(async () => {
    const r = await memoryApi()?.encryptionSecure?.()
    if (r) setState((s) => ({ ...s, cifrado: r }))
    await refresh()
  }, [refresh])

  const confirmRecoveryCode = useCallback(async () => {
    await memoryApi()?.encryptionConfirmRecoveryCode?.()
    setState((s) => ({ ...s, cifrado: null }))
  }, [])
```

y devolverlas en el objeto del hook. Import: `import type { CifradoAlConectar } from '../types'`.

- [ ] **Step 4: `CloudMemoryCard`**

Arriba del `return`, calcular:

```tsx
  const necesitaCifrado = memory.state === 'error' && memory.statusDetail === 'needs_encryption_setup'
  const cifrado = memory.cifrado
```

En `control`, antes de la rama `memory.state === 'error'`:

```tsx
    : necesitaCifrado ? <><Button size="sm" onClick={() => void memory.secureEncryption()}>Turn on encryption</Button>{turnOff}</>
```

En `estado`, como primeras ramas:

```tsx
    necesitaCifrado ? linea("Cloud sync is paused until encryption is on. Only you hold the key — we can't read your memory.", 'warn')
    : memory.state === 'connected' && (memory.plaintextPending ?? 0) > 0 ? linea(`Encrypting your cloud memory… ${memory.plaintextPending} left`, 'warn')
    : …(las ramas existentes)
```

Debajo de `{estado}` dentro del primer `SettingRow`:

```tsx
        {cifrado?.estado === 'activada' && (
          <RecoveryCodeBlock code={cifrado.recoveryCode} aviso={cifrado.aviso} onDone={() => void memory.confirmRecoveryCode()} />
        )}
        {cifrado?.estado === 'esperando-autorizacion' && (
          <div className="flex flex-col gap-1">
            {linea('Approve this machine from one that already has the key (Memory settings → Encryption), comparing this fingerprint:', 'warn')}
            <p className="m-0 select-all font-mono text-fs-sm text-foreground">{cifrado.huella}</p>
          </div>
        )}
        {cifrado?.estado === 'sin-estado' && linea(`Couldn't check encryption — ${cifrado.detalle}. Nothing was uploaded.`, 'destructive')}
```

Import: `import RecoveryCodeBlock from './memories/RecoveryCodeBlock'`.

- [ ] **Step 5: Regenerar el código desde Encryption**

En el estado activo de `MemoryEncryptionCard` (junto a Re-upload), un botón:

```tsx
<Button variant="outline" size="sm" onClick={() => void regenerar()}>New recovery code</Button>
```

con

```tsx
  const regenerar = async () => {
    const r = await api?.encryptionRegenerateRecoveryCode?.()
    if (r?.ok) setCodigo(r.recoveryCode) // el mismo estado que usa la activación para mostrar RecoveryCodeBlock
    else if (r) setError(r.error)
  }
```

Usar los nombres reales de los setters del componente (leer el archivo). Test en `src/__tests__/components/MemoryEncryptionCard.test.tsx`:

```tsx
it('New recovery code muestra el código nuevo', async () => {
  api.encryptionRegenerateRecoveryCode = vi.fn(async () => ({ ok: true, recoveryCode: 'NEW1-NEW2' }))
  // estado activo: el mismo armado que el test existente del estado "On · key #N"
  …render activo…
  fireEvent.click(await screen.findByRole('button', { name: 'New recovery code' }))
  expect(await screen.findByText('NEW1-NEW2')).toBeInTheDocument()
})
```

(«render activo»: copiar el arrange del test existente que verifica `On · key #`.)

- [ ] **Step 6: Tests, typecheck, contraste y commit**

Run:
```bash
npx vitest run src/__tests__/components/CloudMemoryCard-cifrado.test.tsx src/__tests__/components/CloudMemoryCard.test.tsx src/__tests__/components/MemoryEncryptionCard.test.tsx src/__tests__/hooks/useMemory.test.tsx
npx tsc -p tsconfig.web.json --noEmit --composite false
npm run build && npx playwright test e2e/04-contraste.spec.ts
```
Expected: PASS, 0 errores, contraste verde (todo cambio de UI lo pasa, CLAUDE.md).

```bash
git add src/components/memories/RecoveryCodeBlock.tsx src/components/CloudMemoryCard.tsx src/components/MemoryEncryptionCard.tsx src/hooks/useMemory.ts src/__tests__/components/CloudMemoryCard-cifrado.test.tsx src/__tests__/components/MemoryEncryptionCard.test.tsx src/__tests__/hooks/useMemory.test.tsx
git commit -m "feat(memories): el código de recuperación y la espera de autorización al conectar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: CLI — `login` activa el cifrado

**Files:**
- Modify: `electron/enrolamiento-del-paquete.ts`, `electron/enrolamiento-desde-login.ts`, `electron/cli-del-paquete.ts` (`comandoLogin` ~461-552; `comandoStatus`), `electron/daemon-del-paquete.ts` (~línea 69), `electron/estado-de-sync-del-paquete.ts`
- Test: `electron/__tests__/enrolamiento-del-paquete.test.ts`, `electron/__tests__/enrolamiento-desde-login.test.ts`, `electron/__tests__/daemon-del-paquete.test.ts`

**Interfaces:**
- Consumes: `asegurarCifrado` (Task 6), `requireEncryption` (Task 5).
- Produces: `ResultadoDeEnrolamiento` pierde `'cuenta-sin-cifrado'` y suma `{ estado: 'activada'; keyEpoch: number; recoveryCode: string }`. `DepsDeEnrolamiento` suma `activar: (device: DeviceKeyPair) => Promise<{ master: string; keyEpoch: number; recoveryCode: string }>`.

- [ ] **Step 1: Tests**

En `electron/__tests__/enrolamiento-del-paquete.test.ts`, reemplazar el test de `cuenta-sin-cifrado` por:

```ts
it('cuenta en época 0: activa, guarda la maestra y devuelve el código', async () => {
  const guardarMaestra = vi.fn()
  const r = await enrolarEstaMaquina({
    ...depsBase, // el armado que ya usa el archivo
    estadoRemoto: vi.fn(async () => ({ keyEpoch: 0, wrap: null, devices: [] })),
    activar: vi.fn(async () => ({ master: 'M', keyEpoch: 1, recoveryCode: 'CODE-1' })),
    guardarMaestra,
  })
  expect(r).toEqual({ estado: 'activada', keyEpoch: 1, recoveryCode: 'CODE-1' })
  expect(guardarMaestra).toHaveBeenCalledWith('M', 1)
})

it('el mensaje de activada muestra el código y el aviso de pérdida', () => {
  const lineas = mensajeDeEnrolamiento({ estado: 'activada', keyEpoch: 1, recoveryCode: 'CODE-1' }).join('\n')
  expect(lineas).toContain('CODE-1')
  expect(lineas).toContain("We can't recover it for you.")
})
```

(`depsBase`: usar el objeto de deps que ya arma el archivo para los demás casos, sumándole `activar: vi.fn()`; si cada test arma el suyo, sumar `activar` donde haga falta para que typechequee.)

En `electron/__tests__/daemon-del-paquete.test.ts`, un caso: el daemon del paquete en época 0 sin maestra no sube nada (`needs_encryption_setup`), con el fetch simulado que ya usa el archivo.

Run: `npx vitest run electron/__tests__/enrolamiento-del-paquete.test.ts electron/__tests__/daemon-del-paquete.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementar el enrolamiento**

`electron/enrolamiento-del-paquete.ts`:
- Tipo: borrar `| { estado: 'cuenta-sin-cifrado' }`, sumar `| { estado: 'activada'; keyEpoch: number; recoveryCode: string }`.
- `DepsDeEnrolamiento`: sumar `activar`.
- `enrolarEstaMaquina`: después del chequeo de llavero, delegar en `asegurarCifrado`:

```ts
  const propio = d.material()
  const r = await asegurarCifrado({
    material: () => propio,
    adoptar: async (device) => {
      await d.enrolar(device.publicKey)
      const conSobre = await d.estadoRemoto()
      if (conSobre.keyEpoch === 0 || !conSobre.wrap) return null
      return { master: d.desenvolver(device.privateKey, conSobre.wrap.wrapped).toString('base64'), keyEpoch: conSobre.keyEpoch }
    },
    estadoRemoto: () => d.estadoRemoto(),
    activar: (device) => d.activar(device),
    huella: d.huella,
  })
  switch (r.estado) {
    case 'lista':
      if (r.nueva) d.guardarMaestra(r.master, r.keyEpoch)
      return { estado: 'lista', keyEpoch: r.keyEpoch }
    case 'activada':
      d.guardarMaestra(r.master, r.keyEpoch)
      return { estado: 'activada', keyEpoch: r.keyEpoch, recoveryCode: r.recoveryCode }
    case 'esperando-autorizacion':
      return { estado: 'esperando-autorizacion', huella: r.huella }
    case 'sin-estado':
      return { estado: 'error', detalle: r.detalle }
  }
```

Actualizar el comentario de cabecera del archivo: "la cuenta no cifra" deja de existir (spec 2026-11-02: conectar activa).

- `mensajeDeEnrolamiento`: borrar el caso `cuenta-sin-cifrado`, sumar:

```ts
    case 'activada':
      return [
        'Encryption is on. Only you hold the key — we can\'t read your memory.',
        '',
        `  Recovery code:  ${resultado.recoveryCode}`,
        '',
        "Save this recovery code. It's the only way back in if you lose every machine. We can't recover it for you.",
      ]
```

`electron/enrolamiento-desde-login.ts`: sumar a las deps `activar: (device) => activateEncryption(cliente, device)` (import de `./memory-keys-client`).

- [ ] **Step 3: `login` pide `saved`; `status`; daemon del paquete**

En `comandoLogin` (`cli-del-paquete.ts`), en los dos lugares que imprimen `mensajeDeEnrolamiento(await enrolarDesdeLogin(...))`, extraer a una función:

```ts
/** Spec 2026-11-02 §5: con el código en pantalla, no se termina hasta que el usuario escriba
 * `saved`. Ctrl+C sale igual: la maestra ya quedó en el llavero y el código se puede regenerar
 * desde Nest (Memory settings → Encryption → New recovery code). */
async function mostrarEnrolamiento(resultado: ResultadoDeEnrolamiento): Promise<void> {
  for (const linea of mensajeDeEnrolamiento(resultado)) console.log(linea)
  if (resultado.estado !== 'activada') return
  for (;;) {
    console.log('')
    console.log('  Type "saved" once you have stored it, then press enter.')
    if ((await leerUnaLinea()).trim().toLowerCase() === 'saved') return
  }
}
```

y usarla: `await mostrarEnrolamiento(await enrolarDesdeLogin(…))`. Import del tipo `ResultadoDeEnrolamiento`.

`electron/daemon-del-paquete.ts`, junto a `isEncryptionExpected`: `requireEncryption: () => true,`.

`electron/estado-de-sync-del-paquete.ts` (`lineaDeSync`): sumar el detalle `needs_encryption_setup` → `"Cloud sync is paused until encryption is on. Run \`${comando('login')}\` to turn it on."`. Seguir el formato de los otros casos del archivo; agregar el test equivalente en su archivo de tests si lo tiene.

- [ ] **Step 4: Tests y commit**

Run:
```bash
npx vitest run electron/__tests__/enrolamiento-del-paquete.test.ts electron/__tests__/enrolamiento-desde-login.test.ts electron/__tests__/login-del-paquete.test.ts electron/__tests__/daemon-del-paquete.test.ts electron/__tests__/estado-de-sync-del-paquete.test.ts
npx tsc -p tsconfig.node.json --noEmit --composite false
```
Expected: PASS, 0 errores.

```bash
git add electron/enrolamiento-del-paquete.ts electron/enrolamiento-desde-login.ts electron/cli-del-paquete.ts electron/daemon-del-paquete.ts electron/estado-de-sync-del-paquete.ts electron/__tests__/
git commit -m "feat(paquete): login activa el cifrado y muestra el código de recuperación

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: e2e de dos máquinas con el flujo nuevo + verificación final

**Files:**
- Modify: `e2e/12-cifrado-dos-maquinas.spec.ts` (~líneas 69-78 y 122-177)

**Interfaces:**
- Consumes: `connect` devuelve `cifrado` (Task 7); `encryptionConfirmRecoveryCode`.

- [ ] **Step 1: `conectar` devuelve el cifrado**

```ts
async function conectar(page: Page, token: string, deviceId: string): Promise<{ estado: string; recoveryCode?: string; huella?: string }> {
  const r = await page.evaluate(async ({ url, token, deviceId }) => {
    const m = (window as unknown as { memory: Record<string, (...a: unknown[]) => Promise<unknown>> }).memory
    const svc = await m.setSyncService(url)
    const con = await m.connect(token, deviceId)
    return { svc, con }
  }, { url: SYNC_URL!, token, deviceId })
  expect((r.svc as { ok: boolean }).ok, JSON.stringify(r.svc)).toBe(true)
  const con = r.con as { ok?: boolean; cifrado?: { estado: string; recoveryCode?: string; huella?: string } }
  expect(con.ok ?? true, JSON.stringify(con)).toBe(true)
  return con.cifrado ?? { estado: 'desconocido' }
}
```

- [ ] **Step 2: Máquina A — conectar YA cifra**

Reemplazar el tramo "Máquina A" (desde `await conectar(a.page, …)` hasta `const huellaA = …`) por:

```ts
    a = await launchHarness({ withRepo: false })
    const cifradoA = await conectar(a.page, deviceA.token, deviceA.deviceId)
    expect(cifradoA.estado).toBe('activada')
    expect(cifradoA.recoveryCode).toBeTruthy()
    await abrirMemories(a.page)
    await a.page.getByRole('button', { name: 'Memory settings' }).click()
    await expect(a.page.getByText(cifradoA.recoveryCode!)).toBeVisible({ timeout: 20_000 })
    await a.page.screenshot({ path: join(SHOTS, '01-a-conecta-y-ve-el-codigo.png') })
    await a.page.getByLabel('I have saved it somewhere safe').check()
    await a.page.getByRole('button', { name: 'Done' }).click()
    await cerrarMemories(a.page)
    await abrirEncryption(a.page)
    await expect(a.page.getByText(/^On · key #\d+$/)).toBeVisible({ timeout: 20_000 })
    const huellaA = await a.page.getByText(/This account key:/).innerText()
```

(Si Memory settings abre en otra sección que no es Sync, navegar a Sync con el mismo patrón que `abrirEncryption`, con `name: 'Sync'`.)

- [ ] **Step 3: Máquina B — conectar espera**

Reemplazar `await conectar(b.page, …)` por:

```ts
    const cifradoB = await conectar(b.page, deviceB.token, deviceB.deviceId)
    expect(cifradoB.estado).toBe('esperando-autorizacion')
```

y después de leer `huellaB` de la tarjeta, agregar `expect(huellaB).toBe(cifradoB.huella)`. El resto (A autoriza, B adopta y lee) queda igual.

- [ ] **Step 4: Correr el e2e**

Precondiciones: Postgres `nest-memory-pg` y el servidor de sync de la rama corriendo en `SYNC_URL` (ver la cabecera del spec e2e para variables: `SYNC_URL`, `PG_DOCKER`, `DATABASE_URL`).

Run: `npm run build && npx playwright test e2e/12-cifrado-dos-maquinas.spec.ts`
Expected: PASS, y la consulta `select count(*) from observations where title like '%<marca>%'` en 0.

- [ ] **Step 5: Verificación final de la rama**

Run:
```bash
cd server && npx vitest run && npx tsc --noEmit -p tsconfig.json && cd ..
npm run native:node && npx vitest run
npx tsc -p tsconfig.node.json --noEmit --composite false
npx tsc -p tsconfig.web.json --noEmit --composite false
npm run native:electron
```
Expected: todo verde salvo, a lo sumo, `git-exec.test.ts › respeta el timeout` (falla preexistente del 2026-11-02, ajena a este plan — confirmar que sigue siendo la única).

- [ ] **Step 6: Commit**

```bash
git add e2e/12-cifrado-dos-maquinas.spec.ts
git commit -m "test(e2e): dos máquinas con el cifrado obligatorio al conectar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Después del plan (no son tareas de código)

- Actualizar `CLAUDE.md` § "Memoria cifrada — nota operativa": el cifrado ya no es opt-in; `ALLOW_PLAINTEXT_PERSONAL` sólo en tests; `plaintext_pending`; modo `recovery`.
- Antes de deployar el servidor nuevo a staging/prod: avisar a los testers que la próxima versión pide activar el cifrado (las versiones viejas de la app dejan de poder subir en claro).
