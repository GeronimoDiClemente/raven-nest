# El corte comercial: de 4 tiers a 3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app cobre por alojar memoria en la nube y regale todo lo que corre en la máquina del usuario: `Pro` desaparece, nace `Cloud` a $10, y los catorce gates que hoy cierran features locales se borran.

**Architecture:** El cambio es aditivo primero y destructivo después, en ese orden a propósito. Primero `cloud` pasa a existir en todo el camino (servicio, cliente, webhook, perfil) conviviendo con `pro`, así nada se rompe mientras se construye. Recién después se borran los gates locales, se migran los usuarios y se apaga `pro`. Los límites de nube los hace cumplir el servidor — este plan **no** los reimplementa en el cliente: el cliente los muestra.

**Tech Stack:** Electron + React + TypeScript · vitest desde la raíz (`npx vitest run`) · Supabase Edge Functions en Deno · Stripe.

**Spec:** `docs/superpowers/specs/2026-09-02-pricing-memoria-limites-design.md`

**Plan hermano:** `docs/superpowers/plans/2026-09-02-limites-del-servicio-de-sync.md` — hace cumplir los límites del lado del servidor. Este plan asume que su Task 1 (`server/src/limits.ts`, con `cloud` ya en la tabla) está hecha.

## Global Constraints

- **La estructura final son tres niveles**: `Free` ($0, todo lo local más 1 proyecto en la nube) · `Cloud` ($10/mes, proyectos ilimitados) · `Teams` (a medida, memoria compartida), con `enterprise` como el extremo superior de Teams, no como un cuarto plan de venta.
- **Vocabulario de planes en la base y en el código**: `free` · `cloud` · `team` · `enterprise`. `pro` es un alias heredado que mapea a `cloud` hasta la Task 6, y se apaga en la Task 7.
- **Todo lo local es gratis en los tres planes**: panes, los CLIs, el editor, worktrees, diff viewer, spotlight, voice, broadcast, sharing, snippets, workspaces, My Repos, Actions, GitHub/GitLab, MCP, y la memoria local completa.
- **El cliente no decide límites de nube.** Los aplica el servidor (§9.3 de la spec del backend). El cliente muestra lo que `GET /v1/sync/status` le devuelve: `plan`, `quota.used_bytes`, `quota.max_bytes`.
- **Precio: $10/mes.** El precio anual no está definido y **no** se implementa en este plan.
- **Copy del producto en inglés.** Los nombres de los tiers son `Free`, `Cloud`, `Teams`. Los comentarios de código y estos documentos, en español, como el resto del repo.
- **`npx tsc -b` desde la raíz es el typecheck real**; `npx tsc --noEmit` no chequea nada (tsconfig solution-style con `files: []`). `tsc -b` emite `.js`/`.d.ts` al lado de los fuentes: después hay que limpiar con `git clean -fd`, y **`git add` de los archivos nuevos ANTES del clean**, porque clean borra todo lo no trackeado sin distinguir un `.tsx` recién creado de un `.js` emitido.
- **La barra es el código de salida**, no el conteo de tests. Verificar siempre con `; echo EXIT=$?`.
- **Nada que le saque una feature a un usuario existente.** Los 17 usuarios en `pro`/`team` son asignaciones manuales sin un solo cobro detrás (medido el 2026-09-02: cero `stripe_subscription_id` en toda la base), así que la migración es reversible y no rompe ninguna suscripción.

---

### Task 1: `cloud` existe de punta a punta, conviviendo con `pro`

**Files:**
- Modify: `server/src/auth.ts` (la constante `CLOUD_PLANS`)
- Modify: `src/lib/stripe.ts` (el tipo `Plan` y el registro `PLAN_LIMITS`)
- Modify: `src/hooks/useProfile.ts:19` (`computeEffectivePlan`)
- Modify: `supabase/functions/stripe-webhook/eventos.ts:10-15` (el mapa de precios)
- Test: `src/__tests__/lib/planes.test.ts` (nuevo)

**Interfaces:**
- Consumes: `limitsFor` de `server/src/limits.ts`, que ya conoce `cloud` (Task 1 del plan hermano).
- Produces: el valor de plan `'cloud'`, válido en `Plan`, en `PLAN_LIMITS`, en `computeEffectivePlan` y en el gate de nube del servidor. Las tareas siguientes lo asumen existente.

Esta tarea es **puramente aditiva**: al terminar, `pro` y `cloud` funcionan igual de bien. Nada se rompe, y eso es el punto: el corte destructivo viene después, sobre una base que ya soporta el vocabulario nuevo.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/__tests__/lib/planes.test.ts
import { describe, it, expect } from 'vitest'
import { PLAN_LIMITS, type Plan } from '../../lib/stripe'

describe('el plan Cloud', () => {
  it('existe en PLAN_LIMITS', () => {
    expect(PLAN_LIMITS.cloud).toBeDefined()
  })

  it('tiene la nube prendida, igual que pro', () => {
    expect(PLAN_LIMITS.cloud.memoryCloud).toBe(true)
  })

  // Cloud es el tier INDIVIDUAL: paga por alojar SU memoria, no por compartirla.
  it('no puede compartir memoria con un equipo', () => {
    expect(PLAN_LIMITS.cloud.memoryTeamShare).toBe(false)
    expect(PLAN_LIMITS.team.memoryTeamShare).toBe(true)
  })

  it('acepta cloud como valor del tipo Plan', () => {
    const p: Plan = 'cloud'
    expect(PLAN_LIMITS[p]).toBeDefined()
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run src/__tests__/lib/planes.test.ts`
Expected: FAIL — `expected undefined to be defined`, porque `PLAN_LIMITS` sólo tiene `free`, `pro`, `team` y `enterprise`.

- [ ] **Step 3: Implementación mínima**

En `src/lib/stripe.ts`, línea 12, sumar el valor al tipo:

```typescript
// `pro` sigue en el tipo mientras haya perfiles con ese valor guardado en Supabase. Se
// borra en la Task 7, después de migrarlos.
export type Plan = 'free' | 'cloud' | 'pro' | 'team' | 'enterprise'
```

y en `PLAN_LIMITS`, una entrada `cloud` idéntica a la de `pro`:

```typescript
  cloud: {
    ...FULL_FEATURES,
    allowTeam: false,
    memoryTeamShare: false,
    maxMemoryProjects: 50,
    maxCloudObservations: 50_000,
    isEnterprise: false,
  },
```

(`maxMemoryProjects` y `maxCloudObservations` se copian tal cual acá y se **borran** en la Task 3: hoy son código muerto y sacarlos ahora mezclaría dos cambios en una tarea.)

En `src/hooks/useProfile.ts:19`, sumar `cloud` a la lista de planes que se toman tal cual:

```typescript
  if (rawPlan === 'cloud' || rawPlan === 'pro' || rawPlan === 'team' || rawPlan === 'enterprise') {
    return { plan: rawPlan as Plan, isTrialActive: false, trialDaysLeft: 0 }
  }
```

En `server/src/auth.ts`, sumar `cloud` al set:

```typescript
const CLOUD_PLANS = new Set(['cloud', 'pro', 'team', 'enterprise'])
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/lib/planes.test.ts; echo EXIT=$?`
Expected: PASS, 4 tests, `EXIT=0`.

- [ ] **Step 5: Correr el suite entero y el typecheck**

Run: `npx vitest run; echo EXIT=$?` y después `npx tsc -b`
Expected: verde y `EXIT=0`. Ojo: `tsc -b` emite archivos al lado de los fuentes. Hacer `git add` de los archivos nuevos y después `git clean -fd`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stripe.ts src/hooks/useProfile.ts server/src/auth.ts src/__tests__/lib/planes.test.ts supabase/functions/stripe-webhook/eventos.ts
git commit -m "feat(pricing): el plan cloud existe de punta a punta, junto a pro"
```

---

### Task 2: Se borran los catorce gates locales

**Files:**
- Modify: `src/lib/stripe.ts` (la interfaz `PlanLimits`, `FULL_FEATURES` y las cinco entradas de `PLAN_LIMITS`)
- Modify: `src/App.tsx` (líneas 308, 357, 570-572, 589-601, 730-748, 782-788, 1160-1200, 1400, 1500, 1695-1704, 1772, 1849)
- Modify: `src/components/TerminalPane.tsx` (la prop `allowSharing` y el gate del botón Share)
- Modify: `src/components/Sidebar.tsx` y `src/components/UserMenu.tsx` (los tipos de plan)
- Test: `src/__tests__/lib/planes.test.ts` (extender el de la Task 1)

**Interfaces:**
- Consumes: el tipo `Plan` con `cloud` de la Task 1.
- Produces: una `PlanLimits` que sólo describe la nube: `{ memoryLocal, memoryCloud, memoryTeamShare, isEnterprise }`. Todo lo demás deja de existir, y con ello los catorce puntos donde el cliente decidía qué podés hacer en tu propia máquina.

**Ningún test del repo depende hoy de estos gates** — verificado: el único test que toca `PLAN_LIMITS` es `src/__tests__/components/SettingsPanel.test.tsx`, y sólo usa `memoryCloud`, que sobrevive. Que catorce gates comerciales no tengan un solo test es, en sí, parte de por qué se van.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/__tests__/lib/planes.test.ts`:

```typescript
describe('lo local es gratis', () => {
  // La regla del pricing nuevo: lo que corre en la maquina del usuario no nos cuesta
  // nada, asi que no se cobra. Este test es esa regla, ejecutable.
  it('Free y Cloud tienen exactamente las mismas capacidades locales', () => {
    const { memoryCloud: _a, memoryTeamShare: _b, isEnterprise: _c, ...localFree } =
      PLAN_LIMITS.free
    const { memoryCloud: _d, memoryTeamShare: _e, isEnterprise: _f, ...localCloud } =
      PLAN_LIMITS.cloud
    expect(localFree).toEqual(localCloud)
  })

  it('PlanLimits ya no tiene ningun gate de features locales', () => {
    const gatesLocales = [
      'maxPanes', 'allowedAIs', 'allowBroadcast', 'allowVoice', 'allowSharing',
      'allowSnippets', 'allowWorkspaces', 'allowCreateWorktree', 'allowSpotlight',
      'allowDiffViewer', 'allowMyRepos', 'allowActions', 'allowGitHubGitLab',
      'allowMcpWrite', 'allowTeam',
    ]
    for (const gate of gatesLocales) {
      expect(Object.keys(PLAN_LIMITS.free)).not.toContain(gate)
    }
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run src/__tests__/lib/planes.test.ts`
Expected: FAIL en los dos — hoy `PLAN_LIMITS.free` tiene `maxPanes: 3` y `PLAN_LIMITS.cloud` tiene `maxPanes: 12`, así que ni son iguales ni están limpios de gates.

- [ ] **Step 3: Vaciar `PlanLimits`**

En `src/lib/stripe.ts`, la interfaz queda sólo con lo de nube:

```typescript
/**
 * Lo que un plan habilita. Después del pricing del 2026-09-02 esto describe SÓLO la nube:
 * lo que corre en la máquina del usuario no nos cuesta nada y por lo tanto no se cobra, así
 * que no hay nada local que gatear. Los catorce flags que había acá antes gateaban panes,
 * worktrees, voice, sharing y diff viewer — todo local, todo regalado por la competencia
 * OSS, y cada uno un motivo para que nos comparen y perdamos.
 *
 * Los límites numéricos de nube (proyectos, bytes) NO viven acá: los hace cumplir el
 * servidor y el cliente los lee de `GET /v1/sync/status`.
 */
export interface PlanLimits {
  /** Siempre true, en todos los planes. Está explícito porque es la promesa del producto. */
  memoryLocal: boolean
  /** Si la memoria se aloja en nuestra nube y se replica entre máquinas. */
  memoryCloud: boolean
  /** Sólo Teams: promover una memoria a `scope: 'team'`, visible para el resto del equipo. */
  memoryTeamShare: boolean
  /** Meta: si el plan es la punta de Teams (SSO, instancia dedicada, SLA). */
  isEnterprise: boolean
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free:       { memoryLocal: true, memoryCloud: false, memoryTeamShare: false, isEnterprise: false },
  cloud:      { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  // Alias heredado de cloud hasta que la Task 6 migre los perfiles.
  pro:        { memoryLocal: true, memoryCloud: true,  memoryTeamShare: false, isEnterprise: false },
  team:       { memoryLocal: true, memoryCloud: true,  memoryTeamShare: true,  isEnterprise: false },
  enterprise: { memoryLocal: true, memoryCloud: true,  memoryTeamShare: true,  isEnterprise: true },
}
```

Borrar además `FULL_FEATURES` y `ALL_AIS`, que quedan sin uso.

- [ ] **Step 4: Sacar los gates de `App.tsx`**

El typecheck va a marcar cada sitio. En todos, la forma es la misma: se borra la condición y se deja pasar la acción.

- Los cinco usos de `planLimits.maxPanes` (líneas 308, 730, 782, 1160, 1695) pasan a usar la constante `MAX_PANES` que ya existe en el archivo. En `1695`, `workspaceCapacity: Math.min(MAX_PANES, planLimits.maxPanes)` queda `workspaceCapacity: MAX_PANES`, y el `setShowUpgrade(true)` de la línea 1700 se borra entero.
- `if (!planLimits.allowCreateWorktree) { setShowUpgrade(true); return }` (líneas 570 y 589): se borra la línea completa.
- `if (!planLimits.allowDiffViewer) { ... }` (línea 595): se borra.
- `if (!planLimits.allowVoice) { ... }` (línea 1400): se borra.
- `allowSharing={planLimits.allowSharing}` (línea 1772): se borra la prop.
- `if (!planLimits.allowTeam) { setShowUpgrade(true); return }` (línea 1849): **se conserva la idea pero cambia el gate** — Teams sigue siendo pago. Queda `if (!PLAN_LIMITS[plan].memoryTeamShare) { setShowUpgrade(true); return }`.
- Cada `planLimits.X` que se borre hay que sacarlo también del array de dependencias del `useCallback`/`useMemo` correspondiente (líneas 357, 572, 601, 748, 788, 1200, 1500, 1704).

En `src/components/TerminalPane.tsx`, borrar la prop `allowSharing` y el gate del handler de Share; el botón queda siempre habilitado.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run; echo EXIT=$?` y `npx tsc -b`
Expected: verde, `EXIT=0`, typecheck limpio. `SettingsPanel.test.tsx` tiene que seguir pasando sin tocarlo: usa `memoryCloud`, que no cambió.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stripe.ts src/App.tsx src/components/TerminalPane.tsx src/components/Sidebar.tsx src/components/UserMenu.tsx src/__tests__/lib/planes.test.ts
git commit -m "feat(pricing): lo local es gratis — se borran los 14 gates de features locales"
```

---

### Task 3: La cuota se lee del servidor, no de constantes del cliente

**Files:**
- Modify: `src/components/SettingsPanel.tsx` (la tarjeta de memoria)
- Modify: `src/hooks/useMemory.ts` (exponer la cuota que ya devuelve `status`)
- Test: `src/__tests__/components/SettingsPanel.test.tsx` (extender)

**Interfaces:**
- Consumes: `PLAN_LIMITS` reducida de la Task 2.
- Produces: la cuota visible en la UI, tomada de `status`.

`GET /v1/sync/status` ya devuelve `quota: { used_bytes, max_bytes }` y `plan`. El cliente hoy no los muestra. Los campos muertos `maxMemoryProjects` y `maxCloudObservations` ya se fueron con la Task 2 — esta tarea es la que pone en pantalla el dato de verdad, el del servidor.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// agregar a src/__tests__/components/SettingsPanel.test.tsx
it('muestra la cuota que devuelve el servidor, no una constante del cliente', async () => {
  renderSettings({
    plan: 'cloud',
    memory: {
      state: 'connected',
      quota: { used_bytes: 3_183_898, max_bytes: 1024 ** 3 },
    },
  })

  // 3,18 MB de 1 GiB. El texto exacto lo define la implementacion; lo que este test fija
  // es que los dos numeros salen del servidor y llegan a la pantalla.
  expect(await screen.findByText(/3\.[0-9] MB/)).toBeInTheDocument()
  expect(await screen.findByText(/1 GB/)).toBeInTheDocument()
})
```

(El helper `renderSettings` ya existe en ese archivo; extender su tipo de `memory` con `quota` opcional.)

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run src/__tests__/components/SettingsPanel.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /3\.[0-9] MB/`, porque el panel no muestra cuota.

- [ ] **Step 3: Implementación mínima**

En `src/hooks/useMemory.ts`, propagar `quota` desde la respuesta de `status` al estado que expone el hook. En `SettingsPanel.tsx`, dentro de la rama `PLAN_LIMITS[plan].memoryCloud` (línea 471), renderizar una línea con usado y total formateados en unidades legibles.

- [ ] **Step 4: Correr y verificar**

Run: `npx vitest run src/__tests__/components/SettingsPanel.test.tsx; echo EXIT=$?`
Expected: PASS, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.tsx src/hooks/useMemory.ts src/__tests__/components/SettingsPanel.test.tsx
git commit -m "feat(pricing): la cuota de memoria sale del servidor y se ve en Settings"
```

---

### Task 4: El `UpgradeModal` pasa a tres planes

**Files:**
- Modify: `src/components/UpgradeModal.tsx`
- Modify: `src/styles/global.css` (las clases del modal que queden sin uso)
- Test: `src/__tests__/components/UpgradeModal.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `PLAN_PRICING` con el precio nuevo (Task 5 lo cambia a 10; esta tarea lee la constante, no el número).
- Produces: nada que otras tareas consuman.

El disparador del modal cambia de raíz. Antes era "querés un cuarto pane"; ahora es "querés que este segundo proyecto viva en la nube". Las tres cards son Free, Cloud y Teams, y Teams no muestra precio: lleva a Book a demo.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/__tests__/components/UpgradeModal.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UpgradeModal } from '../../components/UpgradeModal'

describe('UpgradeModal', () => {
  it('muestra los tres planes y ninguno mas', () => {
    render(<UpgradeModal open onClose={() => {}} currentPlan="free" />)
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Cloud')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.queryByText('Pro')).not.toBeInTheDocument()
  })

  it('Teams no muestra precio: es venta asistida', () => {
    render(<UpgradeModal open onClose={() => {}} currentPlan="free" />)
    expect(screen.getByRole('link', { name: /book a demo/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correrlo y verificar que falla**

Run: `npx vitest run src/__tests__/components/UpgradeModal.test.tsx`
Expected: FAIL — encuentra "Pro" y no encuentra "Cloud".

- [ ] **Step 3: Implementación**

Reescribir el array de planes del modal con tres entradas. Copy de las cards, en inglés:

- **Free** — "Everything on your machine. Unlimited local memory, all the CLIs, the editor, worktrees. One project synced to the cloud."
- **Cloud — $10/mo** — ★ "Your memory, on every machine you use. Every project synced, backed up, and yours if the disk dies."
- **Teams — Custom** — "Shared memory for the whole team, SSO, and a dedicated instance if you need one." CTA: Book a demo (`BOOK_DEMO_URL`, que ya existe en `src/lib/stripe.ts`).

- [ ] **Step 4: Correr y verificar**

Run: `npx vitest run src/__tests__/components/UpgradeModal.test.tsx; echo EXIT=$?`
Expected: PASS, `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/components/UpgradeModal.tsx src/styles/global.css src/__tests__/components/UpgradeModal.test.tsx
git commit -m "feat(pricing): UpgradeModal de tres planes, disparado por la nube"
```

---

### Task 5: Stripe — el precio de $10

**Files:**
- Modify: `src/lib/stripe.ts` (`STRIPE_PRICES` y `PLAN_PRICING`)
- Modify: `supabase/functions/stripe-webhook/eventos.ts:10-15`
- Test: `supabase/functions/stripe-webhook/__tests__/` (extender el que exista para el mapa de precios)

**Interfaces:**
- Consumes: el plan `cloud` de la Task 1.
- Produces: el price ID nuevo mapeado a `cloud` en el webhook.

⚠️ **Este paso tiene un efecto fuera del repo: crea un Price en la cuenta de Stripe.** Crear el Price lo hace Gero, o requiere su aprobación explícita antes de correr nada contra la API de Stripe. El resto de la tarea es código.

- [ ] **Step 1: Pedir el price ID**

Crear en Stripe un Price recurrente mensual de USD 10 sobre el producto que ya existe, y anotar su id (`price_...`). **No** crear el anual: el precio anual no está definido y queda fuera de este plan.

- [ ] **Step 2: Escribir el test que falla**

```typescript
// en el __tests__ del webhook
import { PRECIO_A_PLAN } from '../eventos.ts'

Deno.test('el precio de Cloud mapea al plan cloud', () => {
  assertEquals(PRECIO_A_PLAN['price_EL_ID_NUEVO'], 'cloud')
})

Deno.test('los precios viejos de pro siguen mapeando, para no romper una suscripcion viva', () => {
  assertEquals(PRECIO_A_PLAN['price_1TJmwsJarRYFmNbKh7G6JXnF'], 'pro')
})
```

- [ ] **Step 3: Correrlo y verificar que falla**

Expected: FAIL — el id nuevo no está en el mapa.

- [ ] **Step 4: Implementación**

Sumar la entrada al mapa de `eventos.ts` sin borrar ninguna de las seis que ya están: un price viejo que desaparece del mapa deja una suscripción viva sin plan.

```typescript
  price_EL_ID_NUEVO: 'cloud',  // cloud mensual $10
```

y en `src/lib/stripe.ts`, `STRIPE_PRICES.cloud_monthly` más `PLAN_PRICING.cloud = { monthly: 10, annual: 10 }` (anual igual al mensual mientras no exista descuento anual).

- [ ] **Step 5: Correr, verificar y commitear**

```bash
git add src/lib/stripe.ts supabase/functions/stripe-webhook/
git commit -m "feat(pricing): price de Cloud a \$10 y su mapeo en el webhook"
```

---

### Task 6: Migrar los 17 perfiles existentes

**Files:**
- Create: `supabase/migrations/20260902000000_plan_cloud.sql`

**Interfaces:**
- Consumes: el vocabulario de planes de la Task 1.
- Produces: cero perfiles con `plan = 'pro'` en producción.

Medido el 2026-09-02: 83 usuarios (66 `free`, 16 `team`, 1 `pro`), **cero con `stripe_subscription_id`**. La tabla `profiles` **no tiene check constraint sobre `plan`** (verificado contra `pg_constraint`), así que no hace falta tocar el schema: la migración es un `UPDATE`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Los 17 perfiles en planes pagos son asignaciones manuales de testeo: cero de ellos tiene
-- una suscripción de Stripe detrás (verificado el 2026-09-02). Por eso esto es un UPDATE y
-- no una migración con período de gracia: no hay un solo cobro que romper.
--
-- `team` se mantiene: sigue existiendo como tier a medida, y los 16 que lo tienen son los
-- testers de las features de equipo.
update public.profiles
   set plan = 'cloud', updated_at = now()
 where plan = 'pro';
```

- [ ] **Step 2: Verificar en local antes de tocar producción**

Correr la migración contra el Supabase local y confirmar con `select plan, count(*) from profiles group by plan` que no queda ningún `pro`.

- [ ] **Step 3: Aplicar a producción**

⚠️ **Efecto fuera del repo.** `release.yml` deploya edge functions pero **no corre migraciones**: es un paso manual, y lo aprueba Gero. Aplicar por el SQL editor del proyecto `qkqlsytxtshgjxwmafpw` y después marcarla como aplicada:

```sql
insert into supabase_migrations.schema_migrations (version) values ('20260902000000');
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260902000000_plan_cloud.sql
git commit -m "feat(pricing): migrar los perfiles pro a cloud"
```

---

### Task 7: Apagar `pro`

**Files:**
- Modify: `src/lib/stripe.ts` (el tipo `Plan` y `PLAN_LIMITS`)
- Modify: `src/hooks/useProfile.ts`
- Modify: `server/src/auth.ts` y `server/src/limits.ts`
- Test: `src/__tests__/lib/planes.test.ts` y `server/__tests__/limits.test.ts`

**Interfaces:**
- Consumes: la Task 6 aplicada **en producción**, no sólo commiteada.
- Produces: el vocabulario final `free | cloud | team | enterprise`.

⚠️ **No arrancar esta tarea hasta que la migración de la Task 6 esté aplicada en producción y verificada.** Si queda un solo perfil con `plan = 'pro'` cuando `pro` sale del código, ese usuario cae a Free y pierde la nube en silencio.

- [ ] **Step 1: Verificar que no queda ningún `pro`**

```sql
select count(*) from public.profiles where plan = 'pro';
```
Expected: `0`. Si no es 0, **parar**: la Task 6 no está aplicada.

- [ ] **Step 2: Invertir los tests que hoy protegen a `pro`**

En `server/__tests__/limits.test.ts`, el test `trata a pro igual que a cloud mientras dure la transicion` pasa a:

```typescript
  it('pro ya no existe: cae a Free como cualquier plan desconocido', () => {
    expect(limitsFor('pro')).toEqual(limitsFor('free'))
  })
```

y en `src/__tests__/lib/planes.test.ts` agregar:

```typescript
  it('el tipo Plan ya no acepta pro', () => {
    expect(Object.keys(PLAN_LIMITS)).not.toContain('pro')
  })
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `npx vitest run src/__tests__/lib/planes.test.ts; cd server && npx vitest run __tests__/limits.test.ts`
Expected: los dos FAIL — `pro` sigue existiendo en ambos lados.

- [ ] **Step 4: Borrar `pro`**

Sacar `'pro'` del tipo `Plan`, de `PLAN_LIMITS`, de `computeEffectivePlan`, de `CLOUD_PLANS` y de `BY_PLAN` en `server/src/limits.ts`. **No** sacar los price IDs viejos del webhook: un Price desaparecido del mapa deja una suscripción sin plan, y esos ids pasan a mapear a `cloud`.

- [ ] **Step 5: Correr todo y commitear**

Run: `npx vitest run; echo EXIT=$?`, `npx tsc -b`, y en `server/`: `npx vitest run; echo EXIT=$?` más `npx tsc --noEmit -p tsconfig.json`
Expected: todo verde y en 0.

```bash
git add -A
git commit -m "feat(pricing): se apaga el plan pro"
```

---

### Task 8: Verificación en la app real

**Files:**
- Ninguno. Es verificación.

- [ ] **Step 1: Levantar la app**

Seguir la receta de la memoria del proyecto para correr el dev al lado del host (necesita su propio `--user-data-dir` por el single-instance lock).

- [ ] **Step 2: Con una cuenta Free, comprobar que no queda ningún gate local**

Abrir 12 panes, crear un worktree, abrir el diff viewer, apretar el botón de Share, activar voice con F5.
Expected: **todo funciona y el `UpgradeModal` no aparece ni una vez.**

- [ ] **Step 3: Comprobar que el gate de nube sí existe**

Con la misma cuenta Free, conectar memoria y sincronizar un segundo proyecto.
Expected: el segundo proyecto **no** sube, sigue funcionando local, y la UI ofrece Cloud.

- [ ] **Step 4: Con una cuenta Cloud, comprobar la cuota**

Expected: Settings muestra el uso y el total que devuelve `status`, no un número del cliente.

---

## Lo que este plan NO hace

- **No cierra §9.2, y eso importa más que todo lo demás acá.** La emisión de tokens sigue viviendo en la edge function `memory-token` de Supabase, que guarda el hash en Supabase, mientras el servicio autentica contra su propia tabla `devices`. **Mientras eso siga así, un usuario real que apriete Connect recibe 401**, tenga el plan que tenga. Este plan deja lista la estructura para cobrar por un producto que todavía no puede conectarse: no cobrarle a nadie hasta que §9.2 esté cerrado.
- **No apunta el build al servicio de Railway.** `getMemorySyncBaseUrl()` (`electron/main.ts:210`) sigue cayendo a `MAIN_VITE_SUPABASE_URL`.
- **No toca `nestmux.com`**, que es otro repo (`pagina-nest`) y tiene su propio flujo de deploy, con el gotcha de que Vercel bloquea en silencio los deploys cuyo autor no es Gero.
- **No define ni implementa el precio anual.**
- **No implementa asientos de Teams**: el servicio no los modela, y los 5 GiB por asiento de la spec son hoy el techo de la cuenta entera.
