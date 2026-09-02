# Equipos en el contrato `admin-api` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar al contrato `/api/internal/*` de Nest las tres rutas de equipos —listar los equipos de un usuario, sacar un miembro y transferir la propiedad— dejando el contrato deployado y verificado contra producción.

**Architecture:** La Edge Function `admin-api` ya tiene el patrón resuelto: la lógica que se puede testear vive en módulos puros (`router.ts`, `mapear.ts`, `pricing.ts`, `allowlist.ts`) con sus tests en vitest, y `index.ts` es sólo wiring HTTP + queries, verificado por smoke real contra producción. Este plan sigue esa división: un módulo nuevo `equipos.ts` con el mapeo y las reglas de negocio —todo puro y testeado— y handlers finos en `index.ts`.

**Tech Stack:** Deno (edge function), `@supabase/supabase-js@2` con service role, vitest para los tests de los módulos puros.

**Spec:** `docs/superpowers/specs/2026-09-02-equipos-y-plan-en-el-back-office-design.md`

## Global Constraints

- **Todos los tests corren con `npx vitest run supabase/functions/admin-api`.** El proyecto `node` de `vitest.config.ts` ya incluye `supabase/functions/**/__tests__/**/*.test.ts`.
- **La barra es el exit code, no el conteo de tests.** `vitest` puede imprimir "N passed" y salir 1 por rechazos no manejados. Verificar siempre con `echo "exit: $?"` después de correr.
- **`index.ts` no tiene tests unitarios** y no se le agregan: no se puede instanciar el cliente de Supabase con service role en vitest. Todo lo testeable va a `equipos.ts`. Lo que queda en `index.ts` se verifica en la Task 8 con `curl` real.
- **Los ids llegan del path y del body: nunca interpolarlos en un filtro de PostgREST por string.** Usar siempre `.eq()` / `.in()` con el valor como parámetro.
- **El audit se escribe también cuando la acción falla**, y su resultado viaja hasta el body como `auditado: false`. No es opcional: hoy la migración no está aplicada en producción, así que **toda** escritura va a devolver ese campo.
- **`git add -f` para todo lo que esté bajo `docs/superpowers/`**: el directorio está gitignoreado y las specs y planes se trackean a mano.
- **Rama de trabajo:** `feat/backoffice-equipos-plan`, que ya existe y tiene la spec commiteada (`830de9e`).

---

### Task 1: Router — las tres rutas nuevas

**Files:**
- Modify: `supabase/functions/admin-api/router.ts`
- Test: `supabase/functions/admin-api/__tests__/router.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produce: `rutaDe()` devolviendo tres nombres nuevos —`'equipos'` (con `id`), `'equipo_miembro'` (con `teamId` y `memberId`) y `'equipo_owner'` (con `teamId`)— y la interfaz `Ruta` con los campos `teamId?: string` y `memberId?: string`. Las tareas 5, 6 y 7 despachan sobre esos nombres.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `__tests__/router.test.ts`, dentro del `describe('rutaDe', ...)`:

```typescript
  it('reconoce los equipos de una cuenta', () => {
    expect(rutaDe('/api/internal/accounts/u1/equipos')).toEqual({ nombre: 'equipos', id: 'u1' })
  })

  it('reconoce los equipos con el prefijo de la function', () => {
    expect(rutaDe('/admin-api/api/internal/accounts/u1/equipos')).toEqual({
      nombre: 'equipos', id: 'u1',
    })
  })

  it('reconoce la ruta de un miembro y saca los dos ids', () => {
    expect(rutaDe('/api/internal/equipos/t1/miembros/m1')).toEqual({
      nombre: 'equipo_miembro', teamId: 't1', memberId: 'm1',
    })
  })

  it('reconoce la ruta de owner de un equipo', () => {
    expect(rutaDe('/api/internal/equipos/t1/owner')).toEqual({
      nombre: 'equipo_owner', teamId: 't1',
    })
  })

  // Un sufijo que no conocemos no puede caer en la ruta del equipo entero: eso
  // convertiría un typo en una escritura sobre el objeto equivocado.
  it('no reconoce un sufijo desconocido de equipos', () => {
    expect(rutaDe('/api/internal/equipos/t1/cualquiera')).toBeNull()
  })

  it('no reconoce la coleccion de equipos sin id', () => {
    expect(rutaDe('/api/internal/equipos')).toBeNull()
  })

  it('no reconoce un miembro sin id de miembro', () => {
    expect(rutaDe('/api/internal/equipos/t1/miembros')).toBeNull()
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run supabase/functions/admin-api/__tests__/router.test.ts
```

Esperado: FAIL. Los cuatro primeros devuelven `null` en vez del objeto esperado.

- [ ] **Step 3: Implementar**

Reemplazar el contenido de `router.ts` por:

```typescript
export type NombreRuta =
  | 'manifest'
  | 'accounts'
  | 'account'
  | 'plan'
  | 'equipos'
  | 'equipo_miembro'
  | 'equipo_owner'

export interface Ruta {
  nombre: NombreRuta
  /** Id de la cuenta (usuario). Sólo en las rutas que cuelgan de `accounts`. */
  id?: string
  /** Id del equipo. Sólo en las rutas que cuelgan de `equipos`. */
  teamId?: string
  /** Id de la fila de `team_members`, no del usuario. */
  memberId?: string
}

/**
 * Parsea el path a una ruta del contrato.
 *
 * Acepta el path con y sin el prefijo `/admin-api`: el back-office arma la URL
 * como `${baseUrl}/api/internal/...` y su baseUrl ya incluye
 * `/functions/v1/admin-api`, pero el prefijo depende de cómo se invoque.
 * `borrar` no sale de acá: es la ruta `account` con método DELETE.
 *
 * Los ids del equipo y del miembro son campos propios en vez de reusar `id`:
 * la ruta de miembros necesita dos, y un solo campo que signifique cosas
 * distintas según la ruta es la clase de ambigüedad que termina en una
 * escritura sobre el objeto equivocado.
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

  if (partes[0] === 'equipos') {
    if (partes.length === 3 && partes[2] === 'owner') {
      return { nombre: 'equipo_owner', teamId: partes[1] }
    }
    if (partes.length === 4 && partes[2] === 'miembros') {
      return { nombre: 'equipo_miembro', teamId: partes[1], memberId: partes[3] }
    }
    return null
  }

  if (partes[0] !== 'accounts') return null
  if (partes.length === 2) return { nombre: 'account', id: partes[1] }
  if (partes.length === 3 && partes[2] === 'plan') return { nombre: 'plan', id: partes[1] }
  if (partes.length === 3 && partes[2] === 'equipos') return { nombre: 'equipos', id: partes[1] }
  return null
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run supabase/functions/admin-api/__tests__/router.test.ts; echo "exit: $?"
```

Esperado: PASS, exit 0, incluidos los tests que ya existían.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/router.ts supabase/functions/admin-api/__tests__/router.test.ts
git commit -m "feat(admin-api): rutas de equipos en el router"
```

---

### Task 2: Mapeo de equipos

**Files:**
- Create: `supabase/functions/admin-api/equipos.ts`
- Test: `supabase/functions/admin-api/__tests__/equipos.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produce: los tipos `FilaTeam`, `FilaMiembro`, `FilaRepo`, `MiembroEquipo`, `RepoEquipo`, `Equipo`, y la función `aEquipos(usuarioId, teams, miembros, repos, mensajesPorEquipo): Equipo[]`. La Task 3 agrega los validadores a este mismo archivo y las tareas 5-7 consumen ambos.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `supabase/functions/admin-api/__tests__/equipos.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { aEquipos, type FilaTeam, type FilaMiembro, type FilaRepo } from '../equipos.ts'

const DUENO = '10663452-fd04-401f-8e92-f5927f503703'
const OTRO = '7d5ad196-a62c-4065-bfb9-f5d7119ddcea'

const TEAM: FilaTeam = {
  id: 't1', name: 'STI-PROJECTS', owner_id: DUENO, created_at: '2026-05-01T10:00:00.000Z',
}

const MIEMBRO_DUENO: FilaMiembro = {
  id: 'm1', team_id: 't1', user_id: DUENO, email: 'gero@nestmux.com',
  role: 'leader', status: 'active', invited_at: null, accepted_at: '2026-05-01T10:00:00.000Z',
}

const MIEMBRO_OTRO: FilaMiembro = {
  id: 'm2', team_id: 't1', user_id: OTRO, email: 'otro@nestmux.com',
  role: 'member', status: 'active', invited_at: '2026-05-02T10:00:00.000Z',
  accepted_at: '2026-05-03T10:00:00.000Z',
}

describe('aEquipos', () => {
  it('marca es_dueno en el equipo cuando el usuario es owner_id', () => {
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], {})
    expect(e.es_dueno).toBe(true)
  })

  it('no marca es_dueno cuando el usuario solo es miembro', () => {
    const [e] = aEquipos(OTRO, [TEAM], [MIEMBRO_DUENO, MIEMBRO_OTRO], [], {})
    expect(e.es_dueno).toBe(false)
  })

  // La propiedad la define teams.owner_id, NO team_members.role: hay equipos
  // reales con 4 miembros marcados 'leader' y un solo dueño.
  it('marca es_dueno del miembro por owner_id y no por el role', () => {
    const cuatroLideres: FilaMiembro[] = [
      MIEMBRO_DUENO,
      { ...MIEMBRO_OTRO, role: 'leader' },
    ]
    const [e] = aEquipos(DUENO, [TEAM], cuatroLideres, [], {})
    expect(e.miembros.find((m) => m.id === 'm1')!.es_dueno).toBe(true)
    expect(e.miembros.find((m) => m.id === 'm2')!.es_dueno).toBe(false)
  })

  it('reporta el dueno con el email que sale de su fila de miembro', () => {
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], {})
    expect(e.dueno).toEqual({ id: DUENO, email: 'gero@nestmux.com' })
  })

  // Los 3 equipos de prueba que hay en produccion no tienen ninguna fila en
  // team_members, ni siquiera la del dueno.
  it('sin filas de miembros el dueno queda sin email en vez de romper', () => {
    const [e] = aEquipos(DUENO, [TEAM], [], [], {})
    expect(e.dueno).toEqual({ id: DUENO, email: null })
    expect(e.miembros).toEqual([])
  })

  // La FK es ON DELETE SET NULL: la fila sobrevive al borrado de la cuenta y
  // sigue ocupando un seat. Es justo la que alguien tiene que poder sacar.
  it('conserva el miembro cuya cuenta se borro, con user_id null', () => {
    const huerfano: FilaMiembro = { ...MIEMBRO_OTRO, user_id: null }
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO, huerfano], [], {})
    const m = e.miembros.find((x) => x.id === 'm2')!
    expect(m.user_id).toBeNull()
    expect(m.email).toBe('otro@nestmux.com')
    expect(m.es_dueno).toBe(false)
  })

  it('normaliza el status ausente a pending y el role ausente a member', () => {
    const raro: FilaMiembro = { ...MIEMBRO_OTRO, role: null, status: null }
    const [e] = aEquipos(DUENO, [TEAM], [raro], [], {})
    expect(e.miembros[0].status).toBe('pending')
    expect(e.miembros[0].role).toBe('member')
  })

  it('mapea los repos compartidos sin el path local', () => {
    const repo: FilaRepo = {
      team_id: 't1', repo_full_name: 'gero/nest', provider: 'github',
      added_at: '2026-06-01T10:00:00.000Z',
    }
    const [e] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [repo], {})
    expect(e.repos).toEqual([
      { full_name: 'gero/nest', provider: 'github', agregado: '2026-06-01T10:00:00.000Z' },
    ])
    expect(JSON.stringify(e.repos)).not.toContain('local_path')
  })

  it('toma el conteo de mensajes del mapa y cae a cero si falta', () => {
    const [conMensajes] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], { t1: 3 })
    expect(conMensajes.mensajes).toBe(3)
    const [sinMensajes] = aEquipos(DUENO, [TEAM], [MIEMBRO_DUENO], [], {})
    expect(sinMensajes.mensajes).toBe(0)
  })

  it('no mezcla miembros ni repos entre equipos', () => {
    const otroTeam: FilaTeam = { ...TEAM, id: 't2', name: 'RENEMED.com' }
    const deOtro: FilaMiembro = { ...MIEMBRO_OTRO, id: 'm9', team_id: 't2' }
    const equipos = aEquipos(DUENO, [TEAM, otroTeam], [MIEMBRO_DUENO, deOtro], [], {})
    expect(equipos.find((e) => e.id === 't1')!.miembros.map((m) => m.id)).toEqual(['m1'])
    expect(equipos.find((e) => e.id === 't2')!.miembros.map((m) => m.id)).toEqual(['m9'])
  })

  it('ordena los equipos propios primero y despues por nombre', () => {
    const ajeno: FilaTeam = { ...TEAM, id: 't2', name: 'AAA ajeno', owner_id: OTRO }
    const equipos = aEquipos(DUENO, [ajeno, TEAM], [], [], {})
    expect(equipos.map((e) => e.id)).toEqual(['t1', 't2'])
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run supabase/functions/admin-api/__tests__/equipos.test.ts
```

Esperado: FAIL — no existe `../equipos.ts`.

- [ ] **Step 3: Implementar**

Crear `supabase/functions/admin-api/equipos.ts`:

```typescript
/** Filas crudas, tal como salen de las tablas. */
export interface FilaTeam {
  id: string
  name: string | null
  owner_id: string
  created_at: string | null
}

export interface FilaMiembro {
  id: string
  team_id: string
  /** `null` cuando la cuenta se borró: la FK es ON DELETE SET NULL. */
  user_id: string | null
  email: string | null
  role: string | null
  status: string | null
  invited_at: string | null
  accepted_at: string | null
}

export interface FilaRepo {
  team_id: string
  repo_full_name: string
  provider: string | null
  added_at: string | null
}

export interface MiembroEquipo {
  /** Id de la fila de `team_members` — es lo que se manda para sacarlo. */
  id: string
  user_id: string | null
  email: string | null
  role: 'leader' | 'member'
  status: 'active' | 'pending'
  es_dueno: boolean
  invitado: string | null
  acepto: string | null
}

export interface RepoEquipo {
  full_name: string
  provider: string | null
  agregado: string | null
}

export interface Equipo {
  id: string
  name: string
  creado: string | null
  /** El usuario de la ficha es `teams.owner_id` de este equipo. */
  es_dueno: boolean
  dueno: { id: string; email: string | null }
  miembros: MiembroEquipo[]
  repos: RepoEquipo[]
  /** Conteo, nunca el contenido de los mensajes. */
  mensajes: number
}

/**
 * Arma los equipos de un usuario a partir de las filas crudas.
 *
 * La propiedad la define **`teams.owner_id`**, no `team_members.role`: en
 * producción hay equipos con cuatro miembros marcados `leader` y un solo
 * dueño, así que mirar el role para decidir quién manda da la respuesta
 * equivocada en la mayoría de los equipos reales.
 *
 * El email del dueño sale de su propia fila de `team_members`. Cuando no
 * existe —los equipos que nunca tuvieron miembros— queda en `null` en vez de
 * disparar una consulta a `auth.users` por un dato decorativo.
 */
export function aEquipos(
  usuarioId: string,
  teams: FilaTeam[],
  miembros: FilaMiembro[],
  repos: FilaRepo[],
  mensajesPorEquipo: Record<string, number>,
): Equipo[] {
  const ordenados = [...teams].sort((a, b) => {
    const propioA = a.owner_id === usuarioId ? 0 : 1
    const propioB = b.owner_id === usuarioId ? 0 : 1
    if (propioA !== propioB) return propioA - propioB
    return (a.name ?? '').localeCompare(b.name ?? '')
  })

  return ordenados.map((t) => {
    const delEquipo = miembros.filter((m) => m.team_id === t.id)
    const filaDueno = delEquipo.find((m) => m.user_id === t.owner_id)

    return {
      id: t.id,
      name: t.name ?? '(sin nombre)',
      creado: t.created_at,
      es_dueno: t.owner_id === usuarioId,
      dueno: { id: t.owner_id, email: filaDueno?.email ?? null },
      miembros: delEquipo.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        email: m.email,
        role: m.role === 'leader' ? 'leader' : 'member',
        // Sin status explícito la fila es una invitación que nadie aceptó:
        // tratarla como activa la haría contar como seat ocupado.
        status: m.status === 'active' ? 'active' : 'pending',
        es_dueno: m.user_id !== null && m.user_id === t.owner_id,
        invitado: m.invited_at,
        acepto: m.accepted_at,
      })),
      repos: repos
        .filter((r) => r.team_id === t.id)
        .map((r) => ({
          full_name: r.repo_full_name,
          provider: r.provider,
          agregado: r.added_at,
        })),
      mensajes: mensajesPorEquipo[t.id] ?? 0,
    }
  })
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run supabase/functions/admin-api/__tests__/equipos.test.ts; echo "exit: $?"
```

Esperado: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/equipos.ts supabase/functions/admin-api/__tests__/equipos.test.ts
git commit -m "feat(admin-api): mapeo de equipos, miembros y repos compartidos"
```

---

### Task 3: Las reglas de sacar y transferir

**Files:**
- Modify: `supabase/functions/admin-api/equipos.ts`
- Test: `supabase/functions/admin-api/__tests__/equipos.test.ts`

**Interfaces:**
- Consumes: `Equipo` y `MiembroEquipo` de la Task 2.
- Produce: `type Veredicto = { ok: true } | { ok: false; status: number; error: string }`, `validarSacarMiembro(equipo: Equipo, memberId: string): Veredicto` y `validarTransferencia(equipo: Equipo, nuevoOwnerId: string): Veredicto`. Las tareas 6 y 7 las llaman antes de escribir.

- [ ] **Step 1: Escribir los tests que fallan**

Extender el import que ya está al tope del archivo para que quede:

```typescript
import {
  aEquipos, validarSacarMiembro, validarTransferencia,
  type FilaTeam, type FilaMiembro, type FilaRepo,
} from '../equipos.ts'
```

Y agregar al final de `__tests__/equipos.test.ts` (los `const` de arriba siguen en alcance):

```typescript
const equipoDe = (miembros: FilaMiembro[]) => aEquipos(DUENO, [TEAM], miembros, [], {})[0]

describe('validarSacarMiembro', () => {
  it('deja sacar a un miembro que no es el dueno', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarSacarMiembro(e, 'm2')).toEqual({ ok: true })
  })

  it('404 si la fila no pertenece a ese equipo', () => {
    const e = equipoDe([MIEMBRO_DUENO])
    expect(validarSacarMiembro(e, 'm2')).toEqual({
      ok: false, status: 404, error: 'Ese miembro no pertenece a este equipo',
    })
  })

  // Un equipo sin owner_id valido no es un estado que la app sepa dibujar.
  it('409 al intentar sacar al dueno', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarSacarMiembro(e, 'm1')).toEqual({
      ok: false, status: 409,
      error: 'No se puede sacar al dueño del equipo. Transferí la propiedad primero.',
    })
  })

  it('deja cancelar una invitacion pendiente', () => {
    const pendiente: FilaMiembro = { ...MIEMBRO_OTRO, status: 'pending', accepted_at: null }
    expect(validarSacarMiembro(equipoDe([MIEMBRO_DUENO, pendiente]), 'm2')).toEqual({ ok: true })
  })
})

describe('validarTransferencia', () => {
  it('deja transferir a un miembro activo', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarTransferencia(e, OTRO)).toEqual({ ok: true })
  })

  it('409 si no hay ningun otro miembro activo a quien transferirle', () => {
    const e = equipoDe([MIEMBRO_DUENO])
    expect(validarTransferencia(e, OTRO)).toEqual({
      ok: false, status: 409,
      error: 'El equipo no tiene otro miembro activo al que transferirle la propiedad',
    })
  })

  // El 409 va antes que el 400: sin candidatos, el problema no es el id que
  // mandaron sino que no hay ninguno posible, y eso es lo que la UI muestra.
  it('el 409 gana sobre el 400 cuando no hay candidatos', () => {
    const e = equipoDe([MIEMBRO_DUENO])
    expect(validarTransferencia(e, 'no-existe')).toMatchObject({ status: 409 })
  })

  it('400 si el destinatario no es miembro del equipo', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarTransferencia(e, 'ajeno')).toEqual({
      ok: false, status: 400, error: 'El nuevo dueño tiene que ser miembro activo del equipo',
    })
  })

  it('400 si el destinatario es miembro pero no acepto la invitacion', () => {
    const pendiente: FilaMiembro = { ...MIEMBRO_OTRO, status: 'pending' }
    const e = equipoDe([MIEMBRO_DUENO, pendiente, { ...MIEMBRO_OTRO, id: 'm3', user_id: 'tercero' }])
    expect(validarTransferencia(e, OTRO)).toMatchObject({ status: 400 })
  })

  it('400 si ya es el dueno, para no auditar un cambio que no ocurre', () => {
    const e = equipoDe([MIEMBRO_DUENO, MIEMBRO_OTRO])
    expect(validarTransferencia(e, DUENO)).toEqual({
      ok: false, status: 400, error: 'Esa persona ya es la dueña del equipo',
    })
  })

  it('no permite transferir a un miembro cuya cuenta se borro', () => {
    const huerfano: FilaMiembro = { ...MIEMBRO_OTRO, user_id: null }
    const e = equipoDe([MIEMBRO_DUENO, huerfano])
    expect(validarTransferencia(e, OTRO)).toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run supabase/functions/admin-api/__tests__/equipos.test.ts
```

Esperado: FAIL — `validarSacarMiembro` y `validarTransferencia` no existen.

- [ ] **Step 3: Implementar**

Agregar al final de `equipos.ts`:

```typescript
export type Veredicto = { ok: true } | { ok: false; status: number; error: string }

/** Los candidatos reales a dueño: activos, con cuenta viva, y que no sean el dueño actual. */
function candidatos(equipo: Equipo): MiembroEquipo[] {
  return equipo.miembros.filter(
    (m) => m.status === 'active' && m.user_id !== null && m.user_id !== equipo.dueno.id,
  )
}

/**
 * ¿Se puede sacar esta fila de `team_members`?
 *
 * Vale igual para un miembro activo y para una invitación pendiente: son la
 * misma fila. Lo único que no se puede sacar es al dueño, porque dejaría el
 * equipo con un `owner_id` que ya no está entre sus miembros.
 */
export function validarSacarMiembro(equipo: Equipo, memberId: string): Veredicto {
  const miembro = equipo.miembros.find((m) => m.id === memberId)
  if (!miembro) {
    return { ok: false, status: 404, error: 'Ese miembro no pertenece a este equipo' }
  }
  if (miembro.es_dueno) {
    return {
      ok: false,
      status: 409,
      error: 'No se puede sacar al dueño del equipo. Transferí la propiedad primero.',
    }
  }
  return { ok: true }
}

/**
 * ¿Se le puede pasar la propiedad del equipo a `nuevoOwnerId`?
 *
 * El orden importa: primero "no hay a quién transferirle" (409) y después "a
 * ese no" (400). Sin candidatos el problema no es el id que mandaron, y la UI
 * necesita saber que el camino entero está cerrado en vez de invitar a probar
 * con otro.
 */
export function validarTransferencia(equipo: Equipo, nuevoOwnerId: string): Veredicto {
  if (candidatos(equipo).length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'El equipo no tiene otro miembro activo al que transferirle la propiedad',
    }
  }
  if (nuevoOwnerId === equipo.dueno.id) {
    return { ok: false, status: 400, error: 'Esa persona ya es la dueña del equipo' }
  }
  if (!candidatos(equipo).some((m) => m.user_id === nuevoOwnerId)) {
    return {
      ok: false,
      status: 400,
      error: 'El nuevo dueño tiene que ser miembro activo del equipo',
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run supabase/functions/admin-api; echo "exit: $?"
```

Esperado: PASS, exit 0, con todos los tests de la función (router, mapear, pricing, allowlist, auth, manifest, equipos).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/equipos.ts supabase/functions/admin-api/__tests__/equipos.test.ts
git commit -m "feat(admin-api): reglas de sacar miembro y transferir propiedad"
```

---

### Task 4: `auditar()` acepta el tipo de objetivo

**Files:**
- Modify: `supabase/functions/admin-api/index.ts` (la función `auditar` y sus llamadas existentes)

**Interfaces:**
- Consumes: nada.
- Produce: `auditar(actor, action, targetType, targetId, targetLabel, before, after, ok, error)` — un parámetro nuevo `targetType: 'user' | 'team'` en tercera posición. Las tareas 6 y 7 lo llaman con `'team'`.

Esta tarea no agrega tests: `auditar` habla con Supabase y vive en `index.ts`, que no es testeable en vitest (ver Global Constraints). Es un refactor mecánico y su red es el typecheck más los tests existentes.

- [ ] **Step 1: Cambiar la firma**

En `index.ts`, en la declaración de `auditar`, agregar el parámetro después de `action` y usarlo en el insert:

```typescript
async function auditar(
  actor: Actor,
  action: string,
  /**
   * Qué clase de objeto se tocó. Las acciones de equipos apuntan a un equipo,
   * no a un usuario, y `target_type` es la única columna que lo distingue:
   * sin esto una transferencia quedaría registrada como si el objetivo fuera
   * una cuenta con un uuid que no existe en `auth.users`.
   */
  targetType: 'user' | 'team',
  targetId: string,
  targetLabel: string | null,
  before: unknown,
  after: unknown,
  ok: boolean,
  error: string | null,
): Promise<boolean> {
```

y en el `insert`, reemplazar `target_type: 'user',` por `target_type: targetType,`.

- [ ] **Step 2: Actualizar las llamadas existentes**

Buscar todas las llamadas y agregarles `'user'` en tercera posición:

```bash
grep -n "await auditar(" supabase/functions/admin-api/index.ts
```

Son las de `change_plan` (3 llamadas), `delete_user` (3) y la del catch (`${ruta.nombre}_error`). Todas quedan `auditar(actor, '<accion>', 'user', ...)`.

- [ ] **Step 3: Verificar que no quedó ninguna sin actualizar**

```bash
grep -n "auditar(" supabase/functions/admin-api/index.ts | grep -v "'user'\|'team'\|async function"
```

Esperado: **ninguna línea**. Cualquier resultado es una llamada que quedó con la firma vieja y que en Deno pasaría el `targetId` como `targetType`, escribiendo el audit contra la columna equivocada sin que ningún test lo note.

- [ ] **Step 4: Correr toda la suite de la función**

```bash
npx vitest run supabase/functions/admin-api; echo "exit: $?"
```

Esperado: PASS, exit 0. Ningún test toca `auditar`, así que esto sólo confirma que no se rompió nada al editar el archivo.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/index.ts
git commit -m "refactor(admin-api): auditar recibe el tipo de objetivo"
```

---

### Task 5: Handler `GET /accounts/:id/equipos`

**Files:**
- Modify: `supabase/functions/admin-api/index.ts`

**Interfaces:**
- Consumes: `rutaDe` con `nombre: 'equipos'` (Task 1); `aEquipos` y los tipos de fila (Task 2).
- Produce: la respuesta `{ equipos: Equipo[] }` que consume el `PanelEquipos` del back-office, y el helper `leerEquipos(usuarioId)` que reusan las tareas 6 y 7 para devolver el equipo actualizado.

- [ ] **Step 1: Agregar el import**

En la cabecera de `index.ts`, junto a los otros imports locales:

```typescript
import {
  aEquipos, validarSacarMiembro, validarTransferencia,
  type Equipo, type FilaMiembro, type FilaRepo, type FilaTeam,
} from './equipos.ts'
```

- [ ] **Step 2: Escribir el lector de equipos**

Agregar antes del handler del request (junto a `buscarUsuario`):

```typescript
const COLUMNAS_MIEMBRO = 'id, team_id, user_id, email, role, status, invited_at, accepted_at'

/**
 * Los equipos donde el usuario es dueño **o** miembro, con todo lo que la
 * ficha muestra.
 *
 * Dos consultas separadas en vez de un `.or()` con el id interpolado: el id
 * viene del path y arma el filtro de PostgREST como texto. `.eq()` y `.in()`
 * lo mandan como parámetro.
 */
async function leerEquipos(usuarioId: string): Promise<Equipo[]> {
  const { data: membresías, error: errMembresías } = await admin
    .from('team_members').select('team_id').eq('user_id', usuarioId)
  if (errMembresías) {
    console.error('[admin-api] leerEquipos: fallo al leer las membresias',
      { usuarioId, error: errMembresías.message })
    throw new Error('No se pudieron leer los equipos')
  }
  const idsPorMembresía = [...new Set((membresías ?? []).map((m) => m.team_id as string))]

  const columnas = 'id, name, owner_id, created_at'
  const { data: propios, error: errPropios } = await admin
    .from('teams').select(columnas).eq('owner_id', usuarioId)
  if (errPropios) {
    console.error('[admin-api] leerEquipos: fallo al leer los equipos propios',
      { usuarioId, error: errPropios.message })
    throw new Error('No se pudieron leer los equipos')
  }

  // Sin ids no se consulta: `.in('id', [])` arma un filtro vacío y no vale la
  // pena averiguar cómo lo interpreta PostgREST.
  let ajenos: FilaTeam[] = []
  if (idsPorMembresía.length) {
    const { data, error } = await admin.from('teams').select(columnas).in('id', idsPorMembresía)
    if (error) {
      console.error('[admin-api] leerEquipos: fallo al leer los equipos por membresia',
        { usuarioId, error: error.message })
      throw new Error('No se pudieron leer los equipos')
    }
    ajenos = (data ?? []) as FilaTeam[]
  }

  const porId = new Map<string, FilaTeam>()
  for (const t of [...propios, ...ajenos] as FilaTeam[]) {
    porId.set(t.id, t)
  }
  const teams = [...porId.values()]
  if (teams.length === 0) return []

  const ids = teams.map((t) => t.id)
  const [miembros, repos, mensajes] = await Promise.all([
    admin.from('team_members').select(COLUMNAS_MIEMBRO).in('team_id', ids),
    // `local_path` es de la máquina de cada uno y no se expone.
    admin.from('team_repos').select('team_id, repo_full_name, provider, added_at').in('team_id', ids),
    // Conteo por equipo con `head: true`: nunca trae el contenido de un mensaje.
    Promise.all(
      ids.map(async (id) => {
        const { count, error } = await admin
          .from('team_chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', id)
        // Este sí degrada, al revés que los de arriba: el conteo de mensajes es
        // decorativo, y perderlo no vuelve engañosa la respuesta. Un miembro o
        // un repo que falta sí, porque sobre eso se decide.
        if (error) {
          console.error('[admin-api] leerEquipos: fallo el conteo de mensajes',
            { teamId: id, error: error.message })
        }
        return [id, count ?? 0] as const
      }),
    ),
  ])

  // Los miembros y los repos son el payload: si no se pudieron leer, la
  // respuesta tiene que fallar y no decir "este equipo no tiene ninguno".
  if (miembros.error || repos.error) {
    console.error('[admin-api] leerEquipos: fallo al leer miembros o repos', {
      usuarioId,
      errorMiembros: miembros.error?.message ?? null,
      errorRepos: repos.error?.message ?? null,
    })
    throw new Error('No se pudieron leer los equipos')
  }

  return aEquipos(
    usuarioId,
    teams,
    (miembros.data ?? []) as FilaMiembro[],
    (repos.data ?? []) as FilaRepo[],
    Object.fromEntries(mensajes),
  )
}
```

- [ ] **Step 3: Agregar el handler**

Justo después del bloque `if (ruta.nombre === 'plan' && req.method === 'PUT') { ... }`:

```typescript
    if (ruta.nombre === 'equipos') {
      if (req.method !== 'GET') return NO_PERMITIDO()
      const buscado = await buscarUsuario(id)
      if (buscado.estado === 'error') {
        console.error('[admin-api] getUserById fallo', { id, detalle: buscado.detalle })
        return json({ error: 'No se pudo verificar la cuenta' }, 500)
      }
      // Es lectura: no se audita, igual que la ficha y la lista de cuentas.
      if (buscado.estado === 'no_encontrado') return json({ error: 'Cuenta no encontrada' }, 404)
      return json({ equipos: await leerEquipos(id) })
    }
```

Nota: `id` ya está definido más arriba en el handler como `ruta.id`. Verificar que el bloque quede **dentro** del mismo `try` que los demás, para que el catch de abajo lo cubra.

- [ ] **Step 4: Verificar que la suite sigue verde**

```bash
npx vitest run supabase/functions/admin-api; echo "exit: $?"
```

Esperado: PASS, exit 0. Este handler no tiene test unitario; se verifica en la Task 8.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-api/index.ts
git commit -m "feat(admin-api): GET de los equipos de una cuenta"
```

---

### Task 6: Handler `DELETE /equipos/:teamId/miembros/:memberId`

**Files:**
- Modify: `supabase/functions/admin-api/index.ts`

**Interfaces:**
- Consumes: `rutaDe` con `nombre: 'equipo_miembro'`, `teamId` y `memberId` (Task 1); `validarSacarMiembro` (Task 3); `leerEquipos` y `auditar` con `'team'` (Tasks 4 y 5).
- Produce: respuesta `{ equipo, ...(auditado ? {} : { auditado: false }) }`.

- [ ] **Step 1: Agregar el handler**

Después del handler de la Task 5:

```typescript
    if (ruta.nombre === 'equipo_miembro') {
      if (req.method !== 'DELETE') return NO_PERMITIDO()
      const teamId = ruta.teamId!

      const { data: fila, error: errEquipo } = await admin
        .from('teams').select('id, name, owner_id, created_at').eq('id', teamId).maybeSingle()
      if (errEquipo) return json({ error: 'No se pudo leer el equipo' }, 500)
      if (!fila) {
        await auditar(actor, 'team_member_removed', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      // Se arman los equipos desde la perspectiva del dueño: alcanza para
      // decidir, y evita pedir el usuario de la ficha que acá no viaja.
      const equipos = await leerEquipos(fila.owner_id as string)
      const equipo = equipos.find((e) => e.id === teamId)
      if (!equipo) {
        // Mismo error que la rama de arriba, así que también deja rastro: dos
        // rechazos indistinguibles para el cliente y uno solo auditado es
        // justo el agujero por donde no se ve quién intentó qué.
        await auditar(actor, 'team_member_removed', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      const veredicto = validarSacarMiembro(equipo, ruta.memberId!)
      if (!veredicto.ok) {
        await auditar(actor, 'team_member_removed', 'team', teamId, equipo.name, null, null,
          false, veredicto.error)
        return json({ error: veredicto.error }, veredicto.status)
      }

      const sacado = equipo.miembros.find((m) => m.id === ruta.memberId)!
      const { error } = await admin.from('team_members').delete().eq('id', ruta.memberId!)

      const auditado = await auditar(
        actor, 'team_member_removed', 'team', teamId, equipo.name,
        { miembro: sacado.email, role: sacado.role, status: sacado.status }, null,
        !error, error?.message ?? null,
      )
      if (error) return json({ error: error.message }, 500)

      const actualizado = (await leerEquipos(fila.owner_id as string)).find((e) => e.id === teamId)
      if (!actualizado) {
        console.error('[admin-api] el equipo desaparecio entre el delete y la relectura', { teamId })
      }
      // `null` explícito y no un error: el miembro se sacó y quedó auditado, así
      // que reportar fallo sería mentir. Y `undefined` tampoco sirve, porque
      // `JSON.stringify` borra la clave y el cliente recibe una respuesta sin
      // `equipo` y sin error.
      return json({ equipo: actualizado ?? null, ...(auditado ? {} : { auditado: false }) })
    }
```

- [ ] **Step 2: Verificar que la suite sigue verde**

```bash
npx vitest run supabase/functions/admin-api; echo "exit: $?"
```

Esperado: PASS, exit 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-api/index.ts
git commit -m "feat(admin-api): sacar un miembro de un equipo"
```

---

### Task 7: Handler `PUT /equipos/:teamId/owner`

**Files:**
- Modify: `supabase/functions/admin-api/index.ts`

**Interfaces:**
- Consumes: `rutaDe` con `nombre: 'equipo_owner'` y `teamId` (Task 1); `validarTransferencia` (Task 3); `leerEquipos` y `auditar` (Tasks 4 y 5).
- Produce: respuesta `{ equipo, cambios: [{ key: 'owner', de, a }], ...(auditado ? {} : { auditado: false }) }`.

- [ ] **Step 1: Agregar el handler**

Después del handler de la Task 6:

```typescript
    if (ruta.nombre === 'equipo_owner') {
      if (req.method !== 'PUT') return NO_PERMITIDO()
      const teamId = ruta.teamId!

      const { data: fila, error: errEquipo } = await admin
        .from('teams').select('id, name, owner_id, created_at').eq('id', teamId).maybeSingle()
      if (errEquipo) return json({ error: 'No se pudo leer el equipo' }, 500)
      if (!fila) {
        await auditar(actor, 'team_owner_transferred', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      const duenoViejo = fila.owner_id as string
      const equipo = (await leerEquipos(duenoViejo)).find((e) => e.id === teamId)
      if (!equipo) {
        // Mismo criterio que la rama de arriba: un rechazo sin rastro es el
        // agujero por donde no se ve quién intentó qué.
        await auditar(actor, 'team_owner_transferred', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      const body = await req.json().catch(() => null) as { owner_id?: string } | null
      const nuevo = body?.owner_id?.trim() ?? ''
      const veredicto = nuevo
        ? validarTransferencia(equipo, nuevo)
        : { ok: false as const, status: 400, error: 'Falta owner_id' }
      if (!veredicto.ok) {
        await auditar(actor, 'team_owner_transferred', 'team', teamId, equipo.name,
          { owner: duenoViejo }, { owner: nuevo || null }, false, veredicto.error)
        return json({ error: veredicto.error }, veredicto.status)
      }

      const { error } = await admin.from('teams').update({ owner_id: nuevo }).eq('id', teamId)
      if (error) {
        await auditar(actor, 'team_owner_transferred', 'team', teamId, equipo.name,
          { owner: duenoViejo }, { owner: nuevo }, false, error.message)
        return json({ error: error.message }, 500)
      }

      // El dueño nuevo pasa a `leader` si no lo era. El viejo NO se toca: sigue
      // siendo miembro, así la transferencia no le saca el acceso a nadie ni
      // cambia la cantidad de seats facturados.
      const { error: errRole } = await admin
        .from('team_members').update({ role: 'leader' })
        .eq('team_id', teamId).eq('user_id', nuevo)

      const auditado = await auditar(
        actor, 'team_owner_transferred', 'team', teamId, equipo.name,
        { owner: duenoViejo }, { owner: nuevo }, true,
        // La propiedad ya se movió; que el role no haya seguido es un aviso,
        // no un fallo de la acción.
        errRole ? `owner movido, role no actualizado: ${errRole.message}` : null,
      )

      const actualizado = (await leerEquipos(nuevo)).find((e) => e.id === teamId)
      if (!actualizado) {
        console.error('[admin-api] el equipo desaparecio entre la transferencia y la relectura',
          { teamId })
      }
      // `null` explícito, no un error ni `undefined`: la propiedad ya se movió y
      // quedó auditada, y `JSON.stringify` borraría la clave dejando al cliente
      // sin `equipo` y sin señal de por qué.
      return json({
        equipo: actualizado ?? null,
        cambios: [{ key: 'owner', de: duenoViejo, a: nuevo }],
        ...(auditado ? {} : { auditado: false }),
      })
    }
```

- [ ] **Step 2: Verificar que la suite sigue verde**

```bash
npx vitest run supabase/functions/admin-api; echo "exit: $?"
```

Esperado: PASS, exit 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-api/index.ts
git commit -m "feat(admin-api): transferir la propiedad de un equipo"
```

---

### Task 8: Manifest, deploy y smoke contra producción

**Files:**
- Modify: `supabase/functions/admin-api/manifest.ts`
- Test: `supabase/functions/admin-api/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produce: el contrato deployado y verificado, que es la precondición del plan de `aira-admin`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `__tests__/manifest.test.ts`:

```typescript
  it('declara la seccion de plan ademas de la de equipos', () => {
    expect(MANIFEST.sections.map((s) => s.module)).toEqual(['nest/equipos', 'nest/plan'])
  })
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run supabase/functions/admin-api/__tests__/manifest.test.ts
```

Esperado: FAIL — hoy sólo declara `nest/equipos`.

- [ ] **Step 3: Implementar**

En `manifest.ts`, reemplazar la línea de `sections` por:

```typescript
  // Declarar una sección que el back-office todavía no implementa es seguro:
  // el core saltea las que no están en su registro y dibuja el resto.
  sections: [
    { key: 'equipos', label: 'Equipos', module: 'nest/equipos' },
    { key: 'plan', label: 'Plan', module: 'nest/plan' },
  ],
```

- [ ] **Step 4: Correr toda la suite**

```bash
npx vitest run supabase/functions/admin-api; echo "exit: $?"
```

Esperado: PASS, exit 0.

- [ ] **Step 5: Commit y deploy**

```bash
git add supabase/functions/admin-api/manifest.ts supabase/functions/admin-api/__tests__/manifest.test.ts
git commit -m "feat(admin-api): declarar la seccion de plan en el manifest"
npx supabase functions deploy admin-api --project-ref qkqlsytxtshgjxwmafpw
```

Deploy **por nombre**, nunca `deploy` a secas: el proyecto tiene 7 funciones y un deploy masivo ya rompió una en el pasado.

- [ ] **Step 6: Smoke de lectura contra producción**

Con `NEST_BASE_URL` y `NEST_ADMIN_API_TOKEN` leídos de
`C:\Users\gerod\RavenProjects\aira-admin\.env.nest.local` (nunca imprimirlos):

El usuario `10663452-fd04-401f-8e92-f5927f503703` es el dueño de `STI-PROJECTS` **y** de
`RENEMED.com`, así que su respuesta ejercita dos equipos con miembros de verdad:

```bash
curl -s -H "Authorization: Bearer $TOK" -H "X-Admin-Actor: smoke" \
  "$NEST_BASE_URL/api/internal/accounts/10663452-fd04-401f-8e92-f5927f503703/equipos" | head -c 1200
```

Verificar: aparecen los equipos con `es_dueno` correcto, los miembros con su `role` y `status`, los repos **sin** `local_path`, y `mensajes` como número.

- [ ] **Step 7: Smoke de los caminos de error**

Los tres equipos sin miembros (`Acme Corp`, `Beta Squad`, `Crimson Devs`) son el caso perfecto: no afectan a nadie.

```bash
# 409: no hay a quien transferirle
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Authorization: Bearer $TOK" -H "X-Admin-Actor: smoke" -H "X-Admin-Motivo: smoke" \
  -H "content-type: application/json" -d '{"owner_id":"00000000-0000-0000-0000-000000000000"}' \
  "$NEST_BASE_URL/api/internal/equipos/36642dae-024c-4bb5-be32-e7ddddfc5d00/owner"

# 400: escritura sin motivo
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Authorization: Bearer $TOK" -H "X-Admin-Actor: smoke" \
  -H "content-type: application/json" -d '{"owner_id":"x"}' \
  "$NEST_BASE_URL/api/internal/equipos/36642dae-024c-4bb5-be32-e7ddddfc5d00/owner"

# 404: equipo inexistente
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  -H "Authorization: Bearer $TOK" -H "X-Admin-Actor: smoke" -H "X-Admin-Motivo: smoke" \
  "$NEST_BASE_URL/api/internal/equipos/00000000-0000-0000-0000-000000000000/miembros/x"

# 405: metodo equivocado sobre una ruta valida
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOK" -H "X-Admin-Actor: smoke" -H "X-Admin-Motivo: smoke" \
  "$NEST_BASE_URL/api/internal/equipos/36642dae-024c-4bb5-be32-e7ddddfc5d00/owner"
```

Esperado, en orden: `409`, `400`, `404`, `405`.

- [ ] **Step 8: 🚦 GATE — el camino feliz necesita datos, y es decisión de Gero**

Ningún equipo de prueba tiene dos miembros, así que **la transferencia exitosa y el sacar-un-miembro no se pueden smokear sin tocar un equipo real**. Las dos opciones, ninguna a tomar por cuenta propia:

- **(a) Gero crea un equipo de prueba** desde la app con dos cuentas suyas. Es el camino limpio.
- **(b) Ida y vuelta sobre `STI-PROJECTS`**: transferir la propiedad a otro miembro y devolverla en el mismo minuto. Es reversible con la misma ruta y no cambia seats, pero es el equipo de trabajo real, con 5 miembros y 28 repos.

**Preguntar antes de ejecutar cualquiera de las dos.** Si se elige (b), verificar con un `GET` inmediatamente después de cada paso que `dueno.id` quedó donde corresponde.

- [ ] **Step 9: Push de la rama**

```bash
git push -u origin feat/backoffice-equipos-plan
```

---

## Lo que este plan NO hace

- **No expone el borrado de usuarios.** Fuera de alcance por decisión del 2026-09-02.
- **No corre la migración del audit.** Hasta que Gero la corra en el SQL editor, cada escritura de este plan responde `auditado: false` y no deja fila. Es esperable y el smoke lo va a mostrar: no es un bug a perseguir.
- **No toca `aira-admin`.** El client, los dos paneles y el registro son el segundo plan, que se escribe cuando este contrato esté verificado y con la forma real de las respuestas a la vista.
