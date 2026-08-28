# Contrato `/api/internal/*` de Nest — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el back-office `aira-admin` pueda listar, ver y operar las cuentas de Nest por HTTP, para poder apagar el `.exe` de raven-admin que reparte la `service_role` en el instalador.

**Architecture:** Una sola Edge Function de Supabase (`admin-api`) con un router interno que sirve las 5 rutas del contrato. Toda la lógica de traducción vive en **módulos puros** —sin Deno, sin `supabase-js`, sin Stripe— que se testean con el vitest que ya tiene el repo. `index.ts` queda como cáscara fina: routing, auth y llamadas a la base.

**Tech Stack:** Deno (Edge Functions), TypeScript, vitest, `@supabase/supabase-js`, Stripe SDK vía `esm.sh`.

**Spec:** `docs/superpowers/specs/2026-08-28-nest-en-aira-backoffice-design.md`

## Global Constraints

- **Ningún endpoint devuelve `github_token` ni `gitlab_token`.** Están en texto plano en `profiles`. La allowlist de la Task 4 es la que lo garantiza.
- **El token de producto exige mínimo 32 caracteres.** Fail-closed: uno más corto se rechaza aunque coincida.
- `X-Admin-Actor` es obligatorio **siempre**, también en lecturas. `X-Admin-Motivo` es obligatorio en **toda** escritura.
- **`voz_suspendida` va `false` fijo** en toda respuesta de cuenta. Es un campo del core de AiraMed y no se toca.
- **Todo import relativo lleva la extensión `.ts` explícita** (`from './pricing.ts'`). Es lo único que hace que el mismo archivo lo resuelvan Deno y vitest.
- **Los módulos puros no importan Deno, `supabase-js` ni Stripe.** Reciben datos ya obtenidos. Si un archivo bajo `admin-api/` necesita alguno de los tres, va en `index.ts`.
- Planes válidos: `free`, `pro`, `team`, `enterprise`. Trial de **15 días**.
- Comentarios y mensajes en español; nombres de campos del contrato en el idioma que ya usa el contrato (`account_label`, `plan_label`, `trial_ends_at`).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/config.toml` | **Crear.** `verify_jwt = false` para `admin-api` y `stripe-webhook` |
| `supabase/functions/admin-api/tipos.ts` | Interfaces del contrato. Sin lógica |
| `supabase/functions/admin-api/auth.ts` | Guard: token, actor, motivo. Puro |
| `supabase/functions/admin-api/manifest.ts` | La constante del manifest. Puro |
| `supabase/functions/admin-api/pricing.ts` | Reglas de pricing de Nest: monto con seats, label con ciclo, trial. Puro |
| `supabase/functions/admin-api/allowlist.ts` | Claves permitidas + verificador recursivo. Puro |
| `supabase/functions/admin-api/mapear.ts` | Filas de la base → shape del contrato. Puro |
| `supabase/functions/admin-api/index.ts` | `Deno.serve`, router, cliente de Supabase, Stripe, audit |
| `supabase/functions/admin-api/__tests__/*.test.ts` | Tests de los módulos puros |
| `supabase/migrations/20260828000000_admin_audit_actor.sql` | **Crear.** Actor y motivo en `admin_audit_log` |
| `vitest.config.ts` | **Modificar.** Sumar el include de `supabase/functions` |

---

### Task 1: Wiring de tests y el guard de auth

Sin esto no hay forma de testear nada de lo que sigue, y el guard es la pieza de la que depende toda la seguridad del contrato.

**Files:**
- Modify: `vitest.config.ts` (el `include` del project `node`)
- Create: `supabase/functions/admin-api/auth.ts`
- Test: `supabase/functions/admin-api/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `verificarAuth(headers: Headers, tokenEsperado: string | undefined, esEscritura: boolean): ResultadoAuth` y el tipo `ResultadoAuth = { ok: true; actor: Actor } | { ok: false; status: number; error: string }`, con `Actor = { id: string; email: string | null; motivo: string | null }`. `LARGO_MINIMO_TOKEN = 32`.

- [ ] **Step 1: Sumar el include de vitest**

En `vitest.config.ts`, dentro del project `node`, el array `include` pasa a:

```ts
          include: [
            'electron/__tests__/**/*.test.ts',
            'src/__tests__/**/*.test.ts',
            'supabase/functions/**/__tests__/**/*.test.ts',
          ],
```

- [ ] **Step 2: Escribir el test que falla**

Crear `supabase/functions/admin-api/__tests__/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { verificarAuth, LARGO_MINIMO_TOKEN } from '../auth.ts'

const TOKEN = 'x'.repeat(40)

function headers(over: Record<string, string> = {}): Headers {
  return new Headers({
    authorization: `Bearer ${TOKEN}`,
    'x-admin-actor': 'staff-1',
    ...over,
  })
}

describe('verificarAuth', () => {
  it('acepta una lectura con token y actor', () => {
    const r = verificarAuth(headers(), TOKEN, false)
    expect(r).toEqual({ ok: true, actor: { id: 'staff-1', email: null, motivo: null } })
  })

  it('toma el email y el motivo cuando vienen', () => {
    const h = headers({ 'x-admin-actor-email': 'a@b.com', 'x-admin-motivo': 'soporte' })
    const r = verificarAuth(h, TOKEN, true)
    expect(r).toEqual({
      ok: true,
      actor: { id: 'staff-1', email: 'a@b.com', motivo: 'soporte' },
    })
  })

  it('rechaza sin header de authorization', () => {
    const h = new Headers({ 'x-admin-actor': 'staff-1' })
    expect(verificarAuth(h, TOKEN, false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  it('rechaza un token que no coincide', () => {
    expect(verificarAuth(headers(), 'y'.repeat(40), false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  // Fail-closed: un token corto se rechaza aunque el header lo repita igual.
  it('rechaza un token de 31 caracteres aunque coincida', () => {
    const corto = 'z'.repeat(31)
    const h = new Headers({ authorization: `Bearer ${corto}`, 'x-admin-actor': 'staff-1' })
    expect(verificarAuth(h, corto, false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  it('rechaza cuando el server no tiene token configurado', () => {
    expect(verificarAuth(headers(), undefined, false)).toEqual({
      ok: false, status: 401, error: 'No autorizado',
    })
  })

  it('exige actor tambien en lecturas', () => {
    const h = new Headers({ authorization: `Bearer ${TOKEN}` })
    expect(verificarAuth(h, TOKEN, false)).toEqual({
      ok: false, status: 400, error: 'Falta X-Admin-Actor',
    })
  })

  it('exige motivo en escrituras', () => {
    expect(verificarAuth(headers(), TOKEN, true)).toEqual({
      ok: false, status: 400, error: 'Falta X-Admin-Motivo',
    })
  })

  it('un motivo en blanco no cuenta como motivo', () => {
    expect(verificarAuth(headers({ 'x-admin-motivo': '   ' }), TOKEN, true)).toEqual({
      ok: false, status: 400, error: 'Falta X-Admin-Motivo',
    })
  })

  it('expone el minimo de 32 que exige el contrato', () => {
    expect(LARGO_MINIMO_TOKEN).toBe(32)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run supabase/functions/admin-api/__tests__/auth.test.ts`
Expected: FAIL — no existe `../auth.ts`.

Si en vez de eso dice "No test files found", el include del Step 1 quedó mal: revisarlo antes de seguir.

- [ ] **Step 4: Implementar el guard**

Crear `supabase/functions/admin-api/auth.ts`:

```ts
/** Mínimo que exige el contrato del back-office. */
export const LARGO_MINIMO_TOKEN = 32

export interface Actor {
  id: string
  email: string | null
  motivo: string | null
}

export type ResultadoAuth =
  | { ok: true; actor: Actor }
  | { ok: false; status: number; error: string }

/**
 * Guard de toda llamada del back-office.
 *
 * Fail-closed a propósito: sin token configurado en el server, o con uno más
 * corto que el mínimo del contrato, se rechaza aunque el header coincida. Un
 * token corto que "funciona" es peor que uno que no está, porque nadie lo mira.
 */
export function verificarAuth(
  headers: Headers,
  tokenEsperado: string | undefined,
  esEscritura: boolean,
): ResultadoAuth {
  const NO_AUTORIZADO = { ok: false, status: 401, error: 'No autorizado' } as const

  if (!tokenEsperado || tokenEsperado.length < LARGO_MINIMO_TOKEN) return NO_AUTORIZADO

  const recibido = headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (recibido.length < LARGO_MINIMO_TOKEN || recibido !== tokenEsperado) return NO_AUTORIZADO

  // El actor se exige también en lecturas: sin actor no hay auditoría, y una
  // lectura de la ficha de una cuenta es información que alguien miró.
  const id = headers.get('x-admin-actor')?.trim()
  if (!id) return { ok: false, status: 400, error: 'Falta X-Admin-Actor' }

  const motivo = headers.get('x-admin-motivo')?.trim() || null
  if (esEscritura && !motivo) return { ok: false, status: 400, error: 'Falta X-Admin-Motivo' }

  return {
    ok: true,
    actor: { id, email: headers.get('x-admin-actor-email')?.trim() || null, motivo },
  }
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run supabase/functions/admin-api/__tests__/auth.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Verificar que no se rompió nada**

Run: `npm test`
Expected: la suite entera verde. Anotar el número de tests: es la línea base de las tareas siguientes.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts supabase/functions/admin-api/
git commit -m "feat(admin-api): guard de auth del contrato + wiring de tests"
```

---

### Task 2: Reglas de pricing de Nest

Acá vive el bug que no se porta: raven-admin ignora `item.quantity` y Team se cobra por seat.

**Files:**
- Create: `supabase/functions/admin-api/pricing.ts`
- Test: `supabase/functions/admin-api/__tests__/pricing.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `montoMensualCents(sub: SubResumen | null): number`, `planLabel(plan: string, sub: SubResumen | null): string`, `trialEndsAt(trialStartedAt: string | null): string | null`, `PLANES_VALIDOS: readonly string[]`, `TRIAL_DIAS = 15`, y el tipo `SubResumen = { status: string; unit_amount: number | null; quantity: number; interval: 'day' | 'week' | 'month' | 'year' | null; interval_count: number; price_id: string | null }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/functions/admin-api/__tests__/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  montoMensualCents, planLabel, trialEndsAt, PLANES_VALIDOS, TRIAL_DIAS,
  type SubResumen,
} from '../pricing.ts'

function sub(over: Partial<SubResumen> = {}): SubResumen {
  return {
    status: 'active', unit_amount: 3500, quantity: 1,
    interval: 'month', interval_count: 1, price_id: 'price_team_monthly',
    ...over,
  }
}

describe('montoMensualCents', () => {
  it('sin suscripcion es 0', () => {
    expect(montoMensualCents(null)).toBe(0)
  })

  it('mensual de 1 seat es el precio', () => {
    expect(montoMensualCents(sub())).toBe(3500)
  })

  // El bug de raven-admin: Team se cobra por seat y el monto ignoraba quantity.
  it('multiplica por los seats', () => {
    expect(montoMensualCents(sub({ quantity: 5 }))).toBe(17500)
  })

  it('prorratea el anual a mensual, con seats', () => {
    // $312/año x 2 seats = 31200 cents / 12 = 2600 por seat
    expect(montoMensualCents(sub({ unit_amount: 31200, interval: 'year', quantity: 2 }))).toBe(5200)
  })

  it('sin unit_amount es 0', () => {
    expect(montoMensualCents(sub({ unit_amount: null }))).toBe(0)
  })
})

describe('planLabel', () => {
  it('dice el ciclo cuando hay suscripcion', () => {
    expect(planLabel('team', sub({ interval: 'year' }))).toBe('Team (anual)')
    expect(planLabel('pro', sub({ interval: 'month' }))).toBe('Pro (mensual)')
  })

  it('sin suscripcion es solo el plan', () => {
    expect(planLabel('free', null)).toBe('Free')
    expect(planLabel('enterprise', null)).toBe('Enterprise')
  })

  it('un plan desconocido se muestra tal cual en vez de romper', () => {
    expect(planLabel('legacy_beta', null)).toBe('legacy_beta')
  })
})

describe('trialEndsAt', () => {
  it('suma 15 dias al inicio del trial', () => {
    expect(trialEndsAt('2026-08-01T00:00:00.000Z')).toBe('2026-08-16T00:00:00.000Z')
  })

  it('sin inicio no hay fin', () => {
    expect(trialEndsAt(null)).toBe(null)
  })

  it('una fecha invalida no explota', () => {
    expect(trialEndsAt('no-es-fecha')).toBe(null)
  })
})

it('los 4 tiers son los validos', () => {
  expect([...PLANES_VALIDOS]).toEqual(['free', 'pro', 'team', 'enterprise'])
  expect(TRIAL_DIAS).toBe(15)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run supabase/functions/admin-api/__tests__/pricing.test.ts`
Expected: FAIL — no existe `../pricing.ts`.

- [ ] **Step 3: Implementar**

Crear `supabase/functions/admin-api/pricing.ts`:

```ts
/** Los 4 tiers de Nest. `enterprise` no es self-serve: se asigna a mano. */
export const PLANES_VALIDOS = ['free', 'pro', 'team', 'enterprise'] as const

export const TRIAL_DIAS = 15

const ETIQUETAS: Record<string, string> = {
  free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise',
}

/** Lo que necesitamos de una suscripción de Stripe, sin depender del SDK. */
export interface SubResumen {
  status: string
  unit_amount: number | null
  quantity: number
  interval: 'day' | 'week' | 'month' | 'year' | null
  interval_count: number
  price_id: string | null
}

/**
 * Monto mensual en centavos.
 *
 * Multiplica por `quantity` porque Team y Enterprise se cobran **por seat**
 * (mínimo 2 y 4). raven-admin no lo hacía: un equipo de 5 seats figuraba como
 * $35 en vez de $175, y el MRR quedaba subestimado.
 */
export function montoMensualCents(sub: SubResumen | null): number {
  if (!sub || !sub.unit_amount) return 0
  const count = sub.interval_count || 1
  const porSeat = sub.unit_amount
  let mensual: number
  switch (sub.interval) {
    case 'year':  mensual = porSeat / (12 * count); break
    case 'week':  mensual = (porSeat * 52) / 12 / count; break
    case 'day':   mensual = (porSeat * 365) / 12 / count; break
    default:      mensual = porSeat / count
  }
  return Math.round(mensual * (sub.quantity || 1))
}

/**
 * El ciclo va en la etiqueta porque el mismo plan tiene precio mensual y anual,
 * y desde el back-office no hay otra forma de distinguirlos de un vistazo.
 */
export function planLabel(plan: string, sub: SubResumen | null): string {
  const base = ETIQUETAS[plan] ?? plan
  if (!sub || !sub.interval) return base
  return `${base} (${sub.interval === 'year' ? 'anual' : 'mensual'})`
}

export function trialEndsAt(trialStartedAt: string | null): string | null {
  if (!trialStartedAt) return null
  const inicio = new Date(trialStartedAt)
  if (Number.isNaN(inicio.getTime())) return null
  return new Date(inicio.getTime() + TRIAL_DIAS * 24 * 60 * 60 * 1000).toISOString()
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run supabase/functions/admin-api/__tests__/pricing.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/
git commit -m "feat(admin-api): reglas de pricing — seats, ciclo y trial de 15 dias"
```

---

### Task 3: La allowlist de campos

El invariante de seguridad del contrato. `profiles` guarda `github_token` y `gitlab_token` en texto plano.

**Files:**
- Create: `supabase/functions/admin-api/allowlist.ts`
- Test: `supabase/functions/admin-api/__tests__/allowlist.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `ACCOUNT_ALLOWED_KEYS: ReadonlySet<string>`, `clavesNoPermitidas(valor: unknown, permitidas: ReadonlySet<string>): string[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/functions/admin-api/__tests__/allowlist.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACCOUNT_ALLOWED_KEYS, clavesNoPermitidas } from '../allowlist.ts'

describe('clavesNoPermitidas', () => {
  const permitidas = new Set(['id', 'name', 'meters', 'key', 'used'])

  it('un objeto limpio no reporta nada', () => {
    expect(clavesNoPermitidas({ id: '1', name: 'a' }, permitidas)).toEqual([])
  })

  it('encuentra una clave no declarada', () => {
    expect(clavesNoPermitidas({ id: '1', github_token: 'ghp_x' }, permitidas))
      .toEqual(['github_token'])
  })

  // El árbol entero, no sólo el primer nivel: un token escondido tres niveles
  // abajo se serializa igual que uno en la raíz.
  it('baja por objetos anidados', () => {
    const arbol = { id: '1', meters: [{ key: 'seats', used: 2, gitlab_token: 'glpat' }] }
    expect(clavesNoPermitidas(arbol, permitidas)).toEqual(['gitlab_token'])
  })

  it('no confunde los indices de un array con claves', () => {
    expect(clavesNoPermitidas({ meters: [{ key: 'a', used: 1 }] }, permitidas)).toEqual([])
  })

  it('reporta cada clave una sola vez', () => {
    const arbol = { meters: [{ github_token: 'a' }, { github_token: 'b' }] }
    expect(clavesNoPermitidas(arbol, permitidas)).toEqual(['github_token'])
  })

  it('null y primitivos no rompen', () => {
    expect(clavesNoPermitidas(null, permitidas)).toEqual([])
    expect(clavesNoPermitidas('texto', permitidas)).toEqual([])
    expect(clavesNoPermitidas({ id: null }, permitidas)).toEqual([])
  })
})

describe('ACCOUNT_ALLOWED_KEYS', () => {
  it('no permite ninguno de los dos tokens', () => {
    expect(ACCOUNT_ALLOWED_KEYS.has('github_token')).toBe(false)
    expect(ACCOUNT_ALLOWED_KEYS.has('gitlab_token')).toBe(false)
  })

  it('permite lo que el contrato declara', () => {
    for (const k of ['id', 'name', 'plan', 'plan_label', 'status', 'created_at',
                     'trial_ends_at', 'voz_suspendida', 'meters', 'health',
                     'flags', 'onboarding']) {
      expect(ACCOUNT_ALLOWED_KEYS.has(k)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run supabase/functions/admin-api/__tests__/allowlist.test.ts`
Expected: FAIL — no existe `../allowlist.ts`.

- [ ] **Step 3: Implementar**

Crear `supabase/functions/admin-api/allowlist.ts`:

```ts
/**
 * Claves que el contrato tiene permitido serializar en una cuenta.
 *
 * Es una allowlist y no una denylist a propósito: `profiles` guarda
 * `github_token` y `gitlab_token` en texto plano, y el día que alguien sume una
 * columna con un secreto, lo seguro es que no salga por default. Una denylist
 * habría que acordarse de actualizarla.
 */
export const ACCOUNT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  // Resumen
  'id', 'name', 'plan', 'plan_label', 'status', 'created_at',
  'trial_ends_at', 'voz_suspendida',
  // Ficha
  'meters', 'health', 'flags', 'onboarding',
  // Items de meters / health / onboarding
  'key', 'label', 'unit', 'used', 'quota', 'pct',
  'detail', 'done', 'manual',
  // Datos de facturación que sí se muestran
  'price_id', 'monto_mensual_cents', 'seats', 'moneda',
])

/**
 * Devuelve las claves del árbol que no están permitidas. Array vacío = limpio.
 * Recorre todo el árbol serializado: un secreto tres niveles abajo llega al
 * cliente igual que uno en la raíz.
 */
export function clavesNoPermitidas(
  valor: unknown,
  permitidas: ReadonlySet<string>,
): string[] {
  const encontradas = new Set<string>()

  const visitar = (nodo: unknown): void => {
    if (nodo === null || typeof nodo !== 'object') return
    if (Array.isArray(nodo)) {
      // Los índices de un array no son claves del contrato: se baja y ya.
      for (const item of nodo) visitar(item)
      return
    }
    for (const [clave, hijo] of Object.entries(nodo)) {
      if (!permitidas.has(clave)) encontradas.add(clave)
      visitar(hijo)
    }
  }

  visitar(valor)
  return [...encontradas]
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run supabase/functions/admin-api/__tests__/allowlist.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/
git commit -m "feat(admin-api): allowlist de campos, para que los tokens no salgan nunca"
```

---

### Task 4: El manifest y los tipos del contrato

**Files:**
- Create: `supabase/functions/admin-api/tipos.ts`
- Create: `supabase/functions/admin-api/manifest.ts`
- Test: `supabase/functions/admin-api/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `MANIFEST: Manifest` y los tipos `Manifest`, `AccountSummary`, `AccountDetail`, `Meter`, `HealthItem`, `OnboardingItem`.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/functions/admin-api/__tests__/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MANIFEST } from '../manifest.ts'

describe('MANIFEST', () => {
  it('se identifica como nest y llama usuario a la cuenta', () => {
    expect(MANIFEST.product).toBe('nest')
    expect(MANIFEST.account_label).toEqual({ singular: 'usuario', plural: 'usuarios' })
  })

  it('declara accounts', () => {
    expect(MANIFEST.capabilities).toContain('accounts')
  })

  // El consumoSchema del core es de AiraMed (fx.mep_ars, credito_min, minutos):
  // declarar usage-index obligaría a inventar números que Nest no tiene.
  it('NO declara usage-index', () => {
    expect(MANIFEST.capabilities).not.toContain('usage-index')
  })

  it('no tiene flags: Nest no tiene flags de staff', () => {
    expect(MANIFEST.flags).toEqual([])
  })

  it('los meters traen key, label y unit', () => {
    expect(MANIFEST.usage_meters.length).toBeGreaterThan(0)
    for (const m of MANIFEST.usage_meters) {
      expect(typeof m.key).toBe('string')
      expect(typeof m.label).toBe('string')
      expect(typeof m.unit).toBe('string')
    }
  })

  it('las secciones traen key, label y module', () => {
    for (const s of MANIFEST.sections) {
      expect(typeof s.key).toBe('string')
      expect(typeof s.label).toBe('string')
      expect(typeof s.module).toBe('string')
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run supabase/functions/admin-api/__tests__/manifest.test.ts`
Expected: FAIL — no existe `../manifest.ts`.

- [ ] **Step 3: Escribir los tipos**

Crear `supabase/functions/admin-api/tipos.ts`:

```ts
export interface Manifest {
  product: string
  account_label: { singular: string; plural: string }
  capabilities: string[]
  flags: { key: string; label: string; default: boolean; staff_only: boolean }[]
  usage_meters: { key: string; label: string; unit: string }[]
  sections: { key: string; label: string; module: string }[]
}

export interface Meter {
  key: string
  label: string
  unit: string
  used: number
  quota: number | null
  pct: number
}

export type EstadoSalud = 'ok' | 'parcial' | 'sin_configurar' | 'suspendido'

export interface HealthItem {
  key: string
  label: string
  status: EstadoSalud
  detail: string | null
}

export interface OnboardingItem {
  key: string
  label: string
  done: boolean
  manual: boolean
  detail: string | null
}

export interface AccountSummary {
  id: string
  name: string
  plan: string
  plan_label: string
  status: string
  created_at: string | null
  trial_ends_at: string | null
  /** Concepto de AiraMed que el core exige. En Nest siempre `false`. */
  voz_suspendida: boolean
}

export interface AccountDetail extends AccountSummary {
  meters: Meter[]
  health: HealthItem[]
  flags: Record<string, boolean>
  onboarding: OnboardingItem[]
}
```

- [ ] **Step 4: Escribir el manifest**

Crear `supabase/functions/admin-api/manifest.ts`:

```ts
import type { Manifest } from './tipos.ts'

/**
 * Lo que Nest declara saber hacer. El back-office arma su navegación con esto
 * y nunca pregunta "¿este producto es Nest?".
 */
export const MANIFEST: Manifest = {
  product: 'nest',
  account_label: { singular: 'usuario', plural: 'usuarios' },
  capabilities: ['accounts'],
  // Nest no tiene flags de staff: `user_preferences` es configuración de UI del
  // usuario y el back-office no tiene por qué tocarla.
  flags: [],
  usage_meters: [
    { key: 'seats', label: 'Seats', unit: 'seats' },
    { key: 'repos', label: 'Repos conectados', unit: 'repos' },
    { key: 'teams', label: 'Equipos', unit: 'equipos' },
  ],
  sections: [{ key: 'equipos', label: 'Equipos', module: 'nest.equipos' }],
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run supabase/functions/admin-api/__tests__/manifest.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-api/
git commit -m "feat(admin-api): manifest de Nest y tipos del contrato"
```

---

### Task 5: El mapeo de cuentas

Traduce las filas de la base al shape del contrato. Es donde se decide qué se ve en la lista y en la ficha.

**Files:**
- Create: `supabase/functions/admin-api/mapear.ts`
- Test: `supabase/functions/admin-api/__tests__/mapear.test.ts`

**Interfaces:**
- Consumes: `SubResumen`, `montoMensualCents`, `planLabel`, `trialEndsAt` (Task 2); `ACCOUNT_ALLOWED_KEYS`, `clavesNoPermitidas` (Task 3); `AccountSummary`, `AccountDetail` (Task 4)
- Produces: `aAccountSummary(u: UsuarioAuth, p: PerfilFila | null, sub: SubResumen | null): AccountSummary` y `aAccountDetail(u, p, sub, extra: DatosFicha): AccountDetail`, con `UsuarioAuth = { id: string; email: string | null; created_at: string }`, `PerfilFila = { plan: string | null; stripe_customer_id: string | null; trial_started_at: string | null }` y `DatosFicha = { repos: number; teams: number; seats: number; stripeCaido: boolean }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `supabase/functions/admin-api/__tests__/mapear.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aAccountSummary, aAccountDetail } from '../mapear.ts'
import { ACCOUNT_ALLOWED_KEYS, clavesNoPermitidas } from '../allowlist.ts'
import type { SubResumen } from '../pricing.ts'

const USUARIO = { id: 'u1', email: 'gero@nestmux.com', created_at: '2026-01-10T12:00:00.000Z' }
const PERFIL = { plan: 'team', stripe_customer_id: 'cus_1', trial_started_at: null }
const SUB: SubResumen = {
  status: 'active', unit_amount: 3500, quantity: 3,
  interval: 'month', interval_count: 1, price_id: 'price_team_monthly',
}
const FICHA = { repos: 4, teams: 2, seats: 3, stripeCaido: false }

describe('aAccountSummary', () => {
  it('usa el email como nombre de la cuenta', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).name).toBe('gero@nestmux.com')
  })

  it('sin email cae a un placeholder con el id, no a vacio', () => {
    const r = aAccountSummary({ ...USUARIO, email: null }, PERFIL, SUB)
    expect(r.name).toBe('(sin email · u1)')
  })

  it('sin perfil el plan es free', () => {
    const r = aAccountSummary(USUARIO, null, null)
    expect(r.plan).toBe('free')
    expect(r.plan_label).toBe('Free')
  })

  it('el label trae el ciclo', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).plan_label).toBe('Team (mensual)')
  })

  it('el status sale de la suscripcion', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).status).toBe('active')
  })

  it('sin suscripcion el status es sin_suscripcion', () => {
    expect(aAccountSummary(USUARIO, PERFIL, null).status).toBe('sin_suscripcion')
  })

  it('calcula el fin del trial', () => {
    const p = { ...PERFIL, trial_started_at: '2026-02-01T00:00:00.000Z' }
    expect(aAccountSummary(USUARIO, p, null).trial_ends_at).toBe('2026-02-16T00:00:00.000Z')
  })

  it('voz_suspendida siempre false: es un campo de AiraMed', () => {
    expect(aAccountSummary(USUARIO, PERFIL, SUB).voz_suspendida).toBe(false)
  })
})

describe('aAccountDetail', () => {
  it('arma los tres meters', () => {
    const r = aAccountDetail(USUARIO, PERFIL, SUB, FICHA)
    expect(r.meters.map((m) => m.key)).toEqual(['seats', 'repos', 'teams'])
    expect(r.meters.find((m) => m.key === 'repos')?.used).toBe(4)
  })

  it('los meters no tienen cupo, asi que quota es null y pct 0', () => {
    const m = aAccountDetail(USUARIO, PERFIL, SUB, FICHA).meters[0]
    expect(m.quota).toBe(null)
    expect(m.pct).toBe(0)
  })

  it('flags vacio: Nest no tiene flags de staff', () => {
    expect(aAccountDetail(USUARIO, PERFIL, SUB, FICHA).flags).toEqual({})
  })

  // El caso real al 2026-08-28: 17 usuarios con plan de pago y ningún customer.
  it('marca el plan de pago sin suscripcion', () => {
    const p = { plan: 'team', stripe_customer_id: null, trial_started_at: null }
    const salud = aAccountDetail(USUARIO, p, null, FICHA).health
    const item = salud.find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('sin_configurar')
    expect(item?.detail).toBe('Plan team asignado sin suscripcion de Stripe')
  })

  it('un plan free sin suscripcion esta ok, no roto', () => {
    const p = { plan: 'free', stripe_customer_id: null, trial_started_at: null }
    const item = aAccountDetail(USUARIO, p, null, FICHA).health
      .find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('ok')
  })

  // Stripe caído no puede parecer "no paga": son cosas distintas.
  it('con Stripe caido informa parcial, no sin_configurar', () => {
    const item = aAccountDetail(USUARIO, PERFIL, null, { ...FICHA, stripeCaido: true }).health
      .find((h) => h.key === 'suscripcion')
    expect(item?.status).toBe('parcial')
    expect(item?.detail).toBe('Stripe no responde: el dato de cobro no esta disponible')
  })

  it('no filtra ninguna clave prohibida', () => {
    const r = aAccountDetail(USUARIO, PERFIL, SUB, FICHA)
    expect(clavesNoPermitidas(r, ACCOUNT_ALLOWED_KEYS)).toEqual([])
  })

  // El test que importa: si alguien serializa el perfil crudo, esto lo caza.
  it('detecta el token si alguien lo dejara entrar', () => {
    const sucio = { ...aAccountDetail(USUARIO, PERFIL, SUB, FICHA), github_token: 'ghp_x' }
    expect(clavesNoPermitidas(sucio, ACCOUNT_ALLOWED_KEYS)).toEqual(['github_token'])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run supabase/functions/admin-api/__tests__/mapear.test.ts`
Expected: FAIL — no existe `../mapear.ts`.

- [ ] **Step 3: Implementar**

Crear `supabase/functions/admin-api/mapear.ts`:

```ts
import { planLabel, trialEndsAt, type SubResumen } from './pricing.ts'
import type { AccountDetail, AccountSummary, HealthItem, Meter } from './tipos.ts'

export interface UsuarioAuth {
  id: string
  email: string | null
  created_at: string
}

export interface PerfilFila {
  plan: string | null
  stripe_customer_id: string | null
  trial_started_at: string | null
}

export interface DatosFicha {
  repos: number
  teams: number
  seats: number
  /** true = no se pudo hablar con Stripe. Distinto de "no tiene suscripción". */
  stripeCaido: boolean
}

function medidor(key: string, label: string, unit: string, used: number): Meter {
  // Ningún meter de Nest tiene cupo hoy: `quota: null` y `pct: 0` es lo honesto.
  // Un pct inventado se dibuja como barra llena en la ficha.
  return { key, label, unit, used, quota: null, pct: 0 }
}

export function aAccountSummary(
  u: UsuarioAuth,
  p: PerfilFila | null,
  sub: SubResumen | null,
): AccountSummary {
  const plan = p?.plan ?? 'free'
  return {
    id: u.id,
    // Sin email la fila quedaría en blanco y no habría cómo identificarla.
    name: u.email ?? `(sin email · ${u.id})`,
    plan,
    plan_label: planLabel(plan, sub),
    status: sub?.status ?? 'sin_suscripcion',
    created_at: u.created_at ?? null,
    trial_ends_at: trialEndsAt(p?.trial_started_at ?? null),
    // Concepto de AiraMed que el core exige. Nest no tiene voz.
    voz_suspendida: false,
  }
}

function saludSuscripcion(
  p: PerfilFila | null,
  sub: SubResumen | null,
  stripeCaido: boolean,
): HealthItem {
  const base = { key: 'suscripcion', label: 'Suscripción' }
  if (stripeCaido) {
    return {
      ...base, status: 'parcial',
      detail: 'Stripe no responde: el dato de cobro no esta disponible',
    }
  }
  const plan = p?.plan ?? 'free'
  // Un plan de pago sin customer es el síntoma del webhook caído: se muestra,
  // no se esconde. Free sin suscripción es lo normal.
  if (plan !== 'free' && !p?.stripe_customer_id) {
    return {
      ...base, status: 'sin_configurar',
      detail: `Plan ${plan} asignado sin suscripcion de Stripe`,
    }
  }
  return { ...base, status: 'ok', detail: sub ? null : 'Sin suscripcion activa' }
}

export function aAccountDetail(
  u: UsuarioAuth,
  p: PerfilFila | null,
  sub: SubResumen | null,
  extra: DatosFicha,
): AccountDetail {
  return {
    ...aAccountSummary(u, p, sub),
    meters: [
      medidor('seats', 'Seats', 'seats', extra.seats),
      medidor('repos', 'Repos conectados', 'repos', extra.repos),
      medidor('teams', 'Equipos', 'equipos', extra.teams),
    ],
    health: [saludSuscripcion(p, sub, extra.stripeCaido)],
    flags: {},
    onboarding: [],
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run supabase/functions/admin-api/__tests__/mapear.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/
git commit -m "feat(admin-api): mapeo de cuentas al shape del contrato"
```

---

### Task 6: La migración del audit

`admin_audit_log` existe en producción pero se creó a mano y no tiene migración en el repo, así que la nueva tiene que ser tolerante.

**Files:**
- Create: `supabase/migrations/20260828000000_admin_audit_actor.sql`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/20260828000000_admin_audit_actor.sql`:

```sql
-- El contrato del back-office exige registrar quién hizo cada acción y por qué.
-- `admin_audit_log` se creó a mano en la base (no tiene migración previa en el
-- repo), así que esto es tolerante a que las columnas ya existan.

alter table public.admin_audit_log
  add column if not exists actor       text,
  add column if not exists actor_email text,
  add column if not exists motivo      text,
  -- Un intento fallido también se audita: saber que alguien quiso borrar una
  -- cuenta y no pudo es información operativa.
  add column if not exists ok          boolean not null default true,
  add column if not exists error       text;

comment on column public.admin_audit_log.actor is
  'X-Admin-Actor: id del staff del back-office. No existe en auth.users de Nest.';
comment on column public.admin_audit_log.motivo is
  'X-Admin-Motivo: obligatorio en toda escritura del contrato.';

create index if not exists admin_audit_log_creado
  on public.admin_audit_log (created_at desc);
```

- [ ] **Step 2: Verificar el SQL contra la base sin aplicarlo**

Confirmar que las columnas todavía no están:

```bash
npx supabase db diff --schema public 2>/dev/null || echo "revisar a mano en el dashboard"
```

Alternativa que no depende del CLI: correr en el SQL editor del dashboard

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='admin_audit_log';
```

Expected: aparecen `id, action, target_type, target_id, target_label, before, after, created_at` y **ninguna** de las 5 nuevas.

- [ ] **Step 3: Aplicar la migración**

Aplicarla desde el dashboard de Supabase (SQL editor) o con `npx supabase db push` si el CLI está linkeado al proyecto.

- [ ] **Step 4: Verificar que quedó aplicada**

Volver a correr el `select` del Step 2.
Expected: ahora aparecen también `actor`, `actor_email`, `motivo`, `ok`, `error`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260828000000_admin_audit_actor.sql
git commit -m "feat(admin-api): actor, motivo y resultado en el audit log"
```

---

### Task 7: El router y la función que responde

Cáscara fina: routing, auth, base de datos, Stripe. Toda la lógica ya está testeada en las tareas anteriores.

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/functions/admin-api/index.ts`
- Test: `supabase/functions/admin-api/__tests__/router.test.ts`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: `rutaDe(pathname: string): Ruta | null`, con `Ruta = { nombre: 'manifest' | 'accounts' | 'account' | 'plan'; id?: string }`. El borrado no es una ruta propia: es `account` con método `DELETE`.

- [ ] **Step 1: Escribir el test del router**

El parseo de rutas es la única parte del `index.ts` que se puede testear sin Deno, y es donde un error manda un `DELETE` a la ruta equivocada. Crear `supabase/functions/admin-api/__tests__/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rutaDe } from '../router.ts'

describe('rutaDe', () => {
  // El back-office pega a `${baseUrl}/api/internal/...` y baseUrl ya incluye
  // /functions/v1/admin-api, así que el path real trae ese prefijo.
  it('reconoce el manifest con el prefijo de la function', () => {
    expect(rutaDe('/admin-api/api/internal/manifest')).toEqual({ nombre: 'manifest' })
  })

  it('reconoce el manifest sin prefijo', () => {
    expect(rutaDe('/api/internal/manifest')).toEqual({ nombre: 'manifest' })
  })

  it('reconoce la lista de cuentas', () => {
    expect(rutaDe('/api/internal/accounts')).toEqual({ nombre: 'accounts' })
  })

  it('reconoce la ficha y saca el id', () => {
    expect(rutaDe('/api/internal/accounts/u1')).toEqual({ nombre: 'account', id: 'u1' })
  })

  it('reconoce la ruta de plan', () => {
    expect(rutaDe('/api/internal/accounts/u1/plan')).toEqual({ nombre: 'plan', id: 'u1' })
  })

  it('ignora la barra final', () => {
    expect(rutaDe('/api/internal/accounts/')).toEqual({ nombre: 'accounts' })
  })

  it('una ruta desconocida es null', () => {
    expect(rutaDe('/api/internal/otra')).toBe(null)
    expect(rutaDe('/api/internal/accounts/u1/otra')).toBe(null)
    expect(rutaDe('/')).toBe(null)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run supabase/functions/admin-api/__tests__/router.test.ts`
Expected: FAIL — no existe `../router.ts`.

- [ ] **Step 3: Implementar el router**

Crear `supabase/functions/admin-api/router.ts`:

```ts
export type NombreRuta = 'manifest' | 'accounts' | 'account' | 'plan'

export interface Ruta {
  nombre: NombreRuta
  id?: string
}

/**
 * Parsea el path a una ruta del contrato.
 *
 * Acepta el path con y sin el prefijo `/admin-api`: el back-office arma la URL
 * como `${baseUrl}/api/internal/...` y su baseUrl ya incluye
 * `/functions/v1/admin-api`, pero el prefijo depende de cómo se invoque.
 * `borrar` no sale de acá: es la ruta `account` con método DELETE.
 */
export function rutaDe(pathname: string): Ruta | null {
  const limpio = pathname.replace(/^\/admin-api/, '').replace(/\/+$/, '')
  const resto = limpio.startsWith('/api/internal') ? limpio.slice('/api/internal'.length) : null
  if (resto === null) return null

  if (resto === '/manifest') return { nombre: 'manifest' }
  if (resto === '' || resto === '/accounts') {
    return resto === '/accounts' ? { nombre: 'accounts' } : null
  }

  const partes = resto.split('/').filter(Boolean)
  if (partes[0] !== 'accounts') return null
  if (partes.length === 2) return { nombre: 'account', id: partes[1] }
  if (partes.length === 3 && partes[2] === 'plan') return { nombre: 'plan', id: partes[1] }
  return null
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run supabase/functions/admin-api/__tests__/router.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Crear el `config.toml`**

Sin esto toda llamada muere en 401 antes de llegar al código. Crear `supabase/config.toml`:

```toml
# Las funciones que autentican por su cuenta necesitan verify_jwt = false:
# el gateway de Supabase, con el default en true, exige un JWT de Supabase y
# rechaza el `Authorization: Bearer <token de producto>` del back-office y la
# firma de Stripe, ambos con 401 antes de llegar al código de la función.
project_id = "qkqlsytxtshgjxwmafpw"

[functions.admin-api]
verify_jwt = false

# Su guard real es la firma de Stripe, que se valida adentro.
[functions.stripe-webhook]
verify_jwt = false
```

- [ ] **Step 6: Escribir la función**

Crear `supabase/functions/admin-api/index.ts`:

```ts
// Edge Function — contrato /api/internal/* que consume el back-office.
// Deploy: supabase functions deploy admin-api
// Secrets: supabase secrets set NEST_ADMIN_API_TOKEN=<32+ chars>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { verificarAuth, type Actor } from './auth.ts'
import { rutaDe } from './router.ts'
import { MANIFEST } from './manifest.ts'
import { aAccountDetail, aAccountSummary } from './mapear.ts'
import { PLANES_VALIDOS, type SubResumen } from './pricing.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** El audit se escribe siempre, también cuando la acción falla. */
async function auditar(
  actor: Actor,
  action: string,
  targetId: string,
  targetLabel: string | null,
  before: unknown,
  after: unknown,
  ok: boolean,
  error: string | null,
) {
  await admin.from('admin_audit_log').insert({
    action,
    target_type: 'user',
    target_id: targetId,
    target_label: targetLabel,
    before,
    after,
    actor: actor.id,
    actor_email: actor.email,
    motivo: actor.motivo,
    ok,
    error,
  })
}

/** Trae la suscripción de un customer. `null` si no tiene; tira si Stripe falla. */
async function subDe(customerId: string | null): Promise<SubResumen | null> {
  if (!customerId) return null
  const subs = await stripe.subscriptions.list({ customer: customerId, limit: 1 })
  const s = subs.data[0]
  if (!s) return null
  const item = s.items.data[0]
  return {
    status: s.status,
    unit_amount: item?.price.unit_amount ?? null,
    quantity: item?.quantity ?? 1,
    interval: item?.price.recurring?.interval ?? null,
    interval_count: item?.price.recurring?.interval_count ?? 1,
    price_id: item?.price.id ?? null,
  }
}

Deno.serve(async (req) => {
  const ruta = rutaDe(new URL(req.url).pathname)
  if (!ruta) return json({ error: 'No encontrado' }, 404)

  const esEscritura = req.method !== 'GET'
  const auth = verificarAuth(
    req.headers,
    Deno.env.get('NEST_ADMIN_API_TOKEN'),
    esEscritura,
  )
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  const { actor } = auth

  try {
    if (ruta.nombre === 'manifest') return json(MANIFEST)

    if (ruta.nombre === 'accounts') {
      const [{ data: usuarios }, { data: perfiles }] = await Promise.all([
        admin.auth.admin.listUsers({ perPage: 1000 }),
        admin.from('profiles').select('id, plan, stripe_customer_id, trial_started_at'),
      ])
      const porId = new Map((perfiles ?? []).map((p) => [p.id, p]))
      // Sin Stripe en la lista a propósito: son 82 cuentas y serían 82 llamadas.
      // El dato de cobro aparece en la ficha.
      const cuentas = (usuarios?.users ?? []).map((u) =>
        aAccountSummary(
          { id: u.id, email: u.email ?? null, created_at: u.created_at },
          porId.get(u.id) ?? null,
          null,
        ),
      )
      return json({ accounts: cuentas })
    }

    const id = ruta.id!

    if (ruta.nombre === 'account' && req.method === 'GET') {
      const { data: authUser } = await admin.auth.admin.getUserById(id)
      if (!authUser?.user) return json({ error: 'Cuenta no encontrada' }, 404)

      const [{ data: perfil }, { count: repos }, { count: teams }] = await Promise.all([
        admin.from('profiles')
          .select('plan, stripe_customer_id, trial_started_at').eq('id', id).maybeSingle(),
        admin.from('user_repos').select('id', { count: 'exact', head: true }).eq('user_id', id),
        admin.from('team_members').select('team_id', { count: 'exact', head: true }).eq('user_id', id),
      ])

      // Stripe caído degrada la ficha, no la tumba: los datos de la base valen
      // igual, y "no disponible" no es lo mismo que "no paga".
      let sub: SubResumen | null = null
      let stripeCaido = false
      try {
        sub = await subDe(perfil?.stripe_customer_id ?? null)
      } catch {
        stripeCaido = true
      }

      return json(
        aAccountDetail(
          { id: authUser.user.id, email: authUser.user.email ?? null, created_at: authUser.user.created_at },
          perfil ?? null,
          sub,
          { repos: repos ?? 0, teams: teams ?? 0, seats: sub?.quantity ?? 0, stripeCaido },
        ),
      )
    }

    if (ruta.nombre === 'plan' && req.method === 'PUT') {
      const body = await req.json().catch(() => null) as { plan?: string } | null
      const plan = body?.plan
      if (!plan || !PLANES_VALIDOS.includes(plan as typeof PLANES_VALIDOS[number])) {
        return json({ error: `Plan invalido. Validos: ${PLANES_VALIDOS.join(', ')}` }, 400)
      }

      const { data: antes } = await admin.from('profiles')
        .select('plan').eq('id', id).maybeSingle()
      const { data: u } = await admin.auth.admin.getUserById(id)
      const email = u?.user?.email ?? null

      const { error } = await admin.from('profiles')
        .update({ plan, updated_at: new Date().toISOString() }).eq('id', id)

      await auditar(actor, 'change_plan', id, email,
        { plan: antes?.plan ?? null }, { plan }, !error, error?.message ?? null)

      if (error) return json({ error: error.message }, 500)
      return json({ cambios: [{ key: 'plan', de: antes?.plan ?? null, a: plan }] })
    }

    if (ruta.nombre === 'account' && req.method === 'DELETE') {
      const { data: u } = await admin.auth.admin.getUserById(id)
      if (!u?.user) return json({ error: 'Cuenta no encontrada' }, 404)
      const email = u.user.email ?? null

      const body = await req.json().catch(() => null) as { email_confirm?: string } | null
      // Misma confirmación que pedía raven-admin: borrar es irreversible.
      if ((body?.email_confirm ?? '').trim().toLowerCase() !== (email ?? '').toLowerCase()) {
        await auditar(actor, 'delete_user', id, email, null, null, false,
          'El email de confirmacion no coincide')
        return json({ error: 'El email de confirmacion no coincide' }, 400)
      }

      const { data: perfil } = await admin.from('profiles')
        .select('plan, stripe_customer_id').eq('id', id).maybeSingle()
      const { error } = await admin.auth.admin.deleteUser(id)

      await auditar(actor, 'delete_user', id, email, perfil ?? null, null,
        !error, error?.message ?? null)

      if (error) return json({ error: error.message }, 500)
      return json({ borrado: true })
    }

    return json({ error: 'Metodo no permitido' }, 405)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
```

- [ ] **Step 7: Correr la suite entera**

Run: `npm test`
Expected: verde, con los tests nuevos sumados a la línea base de la Task 1.

- [ ] **Step 8: Commit**

```bash
git add supabase/config.toml supabase/functions/admin-api/
git commit -m "feat(admin-api): router, config.toml y la function completa"
```

---

### Task 8: Deploy y smoke real

Todo lo anterior está testeado en Node. Esto verifica que **corre en Deno** y que el `verify_jwt` quedó apagado — que es lo único que ningún test unitario puede probar.

**Files:** ninguno (verificación)

- [ ] **Step 1: Generar y cargar el token**

```bash
NEST_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "$NEST_TOKEN"   # guardarlo: va a Infisical en la Task 9
npx supabase secrets set NEST_ADMIN_API_TOKEN="$NEST_TOKEN" --project-ref qkqlsytxtshgjxwmafpw
```

- [ ] **Step 2: Deployar**

```bash
npx supabase functions deploy admin-api --project-ref qkqlsytxtshgjxwmafpw
```

Expected: deploy exitoso. Si el CLI no está linkeado, correr antes `npx supabase link --project-ref qkqlsytxtshgjxwmafpw`.

- [ ] **Step 3: Verificar que el guard rechaza**

```bash
BASE="https://qkqlsytxtshgjxwmafpw.supabase.co/functions/v1/admin-api"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/internal/manifest"
```

Expected: **`401`**.

Si devuelve `401` con un body que menciona un JWT, el `config.toml` no se aplicó: el rechazo viene del gateway y no del guard. Verificar que el deploy incluyó el config y repetir.

- [ ] **Step 4: Verificar el camino feliz**

```bash
curl -s "$BASE/api/internal/manifest" \
  -H "authorization: Bearer $NEST_TOKEN" -H "x-admin-actor: smoke"
```

Expected: el JSON del manifest, con `"product":"nest"`.

- [ ] **Step 5: Verificar que el actor es obligatorio**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/internal/manifest" \
  -H "authorization: Bearer $NEST_TOKEN"
```

Expected: **`400`**.

- [ ] **Step 6: Verificar la lista y que no salen tokens**

```bash
curl -s "$BASE/api/internal/accounts" \
  -H "authorization: Bearer $NEST_TOKEN" -H "x-admin-actor: smoke" \
  | grep -c "github_token\|gitlab_token"
```

Expected: **`0`**. Cualquier otro número es un release-blocker: parar y volver a la Task 3.

- [ ] **Step 7: Verificar la ficha de una cuenta real**

```bash
UID=$(curl -s "$BASE/api/internal/accounts" \
  -H "authorization: Bearer $NEST_TOKEN" -H "x-admin-actor: smoke" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).accounts[0].id")
curl -s "$BASE/api/internal/accounts/$UID" \
  -H "authorization: Bearer $NEST_TOKEN" -H "x-admin-actor: smoke"
```

Expected: la ficha con `meters`, `health` y `flags: {}`. En una cuenta de plan `team` sin customer, el item `suscripcion` debe decir `sin_configurar`.

- [ ] **Step 8: Verificar que una escritura sin motivo se rechaza**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT "$BASE/api/internal/accounts/$UID/plan" \
  -H "authorization: Bearer $NEST_TOKEN" -H "x-admin-actor: smoke" \
  -H "content-type: application/json" -d '{"plan":"pro"}'
```

Expected: **`400`**.

- [ ] **Step 9: Verificar que el webhook de Stripe sigue vivo**

El `config.toml` cambió su `verify_jwt`, así que hay que confirmar que sigue rechazando una firma inválida por su propio guard:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://qkqlsytxtshgjxwmafpw.supabase.co/functions/v1/stripe-webhook" \
  -H "stripe-signature: falsa" -d '{}'
```

Expected: **`400`** (firma inválida), **no** `401`. Un `401` significa que el gateway lo sigue cortando; un `200` significa que no está validando la firma y eso es un problema mayor.

- [ ] **Step 10: Anotar el resultado del smoke**

Registrar en el PR o en el commit qué devolvió cada paso. Si alguno falló, no seguir a la Task 9.

---

### Task 9: Alta de Nest en el back-office

Va en el otro repo. Sólo arrancar con el smoke de la Task 8 en verde.

**Files (en `C:\Users\gerod\RavenProjects\aira-admin`):**
- Modify: `src/core/products/registry.ts` (el array `DEFINICIONES`)
- Modify: `src/core/products/client.ts` (dos métodos aditivos)
- Create: `src/products/nest/` (el módulo del producto)

- [ ] **Step 1: Crear la rama**

```bash
cd C:/Users/gerod/RavenProjects/aira-admin
git checkout -b feat/producto-nest
npm ci
```

- [ ] **Step 2: Sumar Nest al registry**

En `src/core/products/registry.ts`, el array `DEFINICIONES` pasa a:

```ts
const DEFINICIONES = [
  {
    slug: "airamed",
    nombre: "AiraMed",
    urlEnv: "AIRAMED_BASE_URL",
    tokenEnv: "AIRAMED_ADMIN_API_TOKEN",
  },
  {
    slug: "nest",
    nombre: "Nest",
    urlEnv: "NEST_BASE_URL",
    tokenEnv: "NEST_ADMIN_API_TOKEN",
  },
] as const
```

- [ ] **Step 3: Correr los tests del repo**

Run: `npm test`
Expected: verde. `registry.test.ts` puede necesitar ajuste si asume un solo producto: si falla, leer el test y actualizarlo para que contemple dos.

- [ ] **Step 4: Cargar las env vars**

En Infisical, proyecto `aira-admin`, entorno `dev`:

```
NEST_BASE_URL=https://qkqlsytxtshgjxwmafpw.supabase.co/functions/v1/admin-api
NEST_ADMIN_API_TOKEN=<el token de la Task 8>
```

Después: `infisical export --env=dev > .env.local`

- [ ] **Step 5: Levantar y verificar que Nest aparece**

```bash
npm run dev   # http://localhost:3100
```

Expected: "Nest" en la barra lateral, y `/p/nest/cuentas` lista los 82 usuarios con su plan.

Si Nest no aparece, es el registry: un producto a medio configurar se saltea en silencio por diseño. Revisar que las dos env vars estén y que el token tenga 32+ caracteres.

- [ ] **Step 6: Verificar la ficha**

Abrir una cuenta con plan `team`.
Expected: los tres meters y el item de salud `sin_configurar` diciendo que el plan no tiene suscripción.

- [ ] **Step 7: Sumar los dos métodos al cliente**

En `src/core/products/client.ts`, dentro de `ProductClient`, siguiendo el patrón de los métodos que ya están:

```ts
  /** Cambia el plan de una cuenta. Bespoke de Nest: AiraMed no tiene planes editables. */
  async cambiarPlan(id: string, plan: string, motivo: string) {
    return this.pedir(
      "PUT",
      `/api/internal/accounts/${encodeURIComponent(id)}/plan`,
      (sobre) => z.array(cambioFlagSchema).parse(sobre.cambios),
      { motivo, body: { plan } },
    )
  }

  /** Borra una cuenta. Pide el email como confirmación: es irreversible. */
  async borrarCuenta(id: string, emailConfirm: string, motivo: string) {
    return this.pedir(
      "DELETE",
      `/api/internal/accounts/${encodeURIComponent(id)}`,
      (sobre) => z.boolean().parse(sobre.borrado),
      { motivo, body: { email_confirm: emailConfirm } },
    )
  }
```

**Antes de que eso compile** hay que ampliar el tipo del parámetro `metodo` de
`pedir`, que hoy es `"GET" | "PUT" | "POST"`:

```ts
  private async pedir<T>(
    metodo: "GET" | "PUT" | "POST" | "DELETE",
```

Es una línea y no afecta a ninguna llamada existente: la guarda de motivo
obligatorio es `metodo !== "GET"`, así que `DELETE` ya queda cubierta.

- [ ] **Step 8: Correr la verificación completa del repo**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: todo verde. `aislamiento.test.ts` tiene que seguir pasando: nada del módulo nuevo puede importar fuera del proyecto.

- [ ] **Step 9: Commit y PR**

```bash
git add -A
git commit -m "feat(nest): alta de Nest como producto del back-office"
git push -u origin feat/producto-nest
gh pr create --title "feat(nest): alta de Nest como producto del back-office" --body "$(cat <<'CUERPO'
Suma **Nest** como segundo producto del back-office. Nest es el multiplexor de
terminales para agentes de IA; su admin vivía en una app Electron local y pasa acá.

## Qué toca

- `registry.ts`: una entrada más en `DEFINICIONES` (`nest`, con sus dos env vars).
- `client.ts`: dos métodos aditivos (`cambiarPlan`, `borrarCuenta`) y `DELETE`
  sumado al tipo de `metodo`. **Nada de AiraMed cambia de comportamiento.**
- `src/products/nest/`: el módulo del producto.

## Qué NO toca

Ni los schemas del core, ni las páginas genéricas de cuentas, ni el RBAC. Nest
manda `voz_suspendida: false` para cumplir el `accountSummarySchema` tal como está.

## Estado del otro lado

El contrato `/api/internal/*` ya está deployado como Edge Function de Supabase y
smokeado con curl: guard de token (401), actor obligatorio (400), motivo
obligatorio en escrituras (400), lista y ficha respondiendo, y verificado que
ningún endpoint devuelve tokens de GitHub/GitLab.

## Env vars

Van en Infisical, proyecto `aira-admin`: `NEST_BASE_URL` y `NEST_ADMIN_API_TOKEN`.
Sin las dos, el producto simplemente no aparece en la nav (comportamiento del registry).
CUERPO
)"
```

---

### Task 10: Apagar raven-admin

Sólo cuando el back-office esté operando Nest de verdad. Es el gate que cierra el problema de seguridad.

- [ ] **Step 1: Verificar paridad**

Comparar contra raven-admin, cuenta por cuenta en una muestra de 5: plan, fecha de alta, último login, cantidad de repos.
Expected: coinciden. **Salvo el monto**, que en raven-admin está subestimado en las cuentas Team con más de un seat — ahí el correcto es el nuevo.

- [ ] **Step 2: Anotar lo que queda sin cubrir**

La sección de equipos (`nest.equipos`) está declarada en el manifest pero no implementada, así que las pantallas de teams de raven-admin todavía no tienen reemplazo. Decidir si eso bloquea el apagado o no.

- [ ] **Step 3: Marcar el repo como archivado**

Cuando la paridad esté confirmada, archivar `GeronimoDiClemente/raven-admin` en GitHub y borrar el `.exe` instalado de las máquinas donde esté, **que es el objetivo real de toda esta tanda**: mientras ese instalador exista, la `service_role` sigue repartida.

- [ ] **Step 4: Rotar la `service_role`**

El `.exe` la embebía. Una vez apagado, rotarla desde el dashboard de Supabase y actualizar donde esté cargada (las Edge Functions la leen del entorno, así que se re-deployan solas).

---

## Notas de ejecución

**El orden importa.** Las tareas 1-7 son en `raven-nest` y no dependen de nadie. La 8 necesita acceso al proyecto de Supabase. La 9 necesita el smoke verde y toca el repo de Lucas. La 10 es el cierre y necesita decisión de Gero.

**Si `npm test` no encuentra los tests nuevos**, el include de la Task 1 quedó mal: es lo primero a revisar, porque todas las tareas siguientes dependen de eso.

**Si Deno se queja de un import**, verificar que lleve la extensión `.ts`. Es la causa más común y no la caza ningún test de Node.
