# Los paneles de Nest en el back-office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que desde `admin.airamed.io` se pueda cambiar el plan de un usuario de Nest y operar sus equipos —ver miembros y repos, sacar a alguien, transferir la propiedad— con motivo obligatorio y auditoría de los dos lados.

**Architecture:** Todo bespoke en `src/products/nest/`, siguiendo el patrón que AiraMed ya usa: un componente `"use client"` que recibe `PropsSeccion`, un `acciones.ts` propio con las server actions, y el `DialogMotivo` del core para pedir el por qué. Del core se tocan sólo tres cosas, todas aditivas: los schemas zod de la respuesta de equipos, cuatro métodos en `ProductClient`, y tres etiquetas en el mapa del audit. **Ni una pantalla, ni el RBAC.**

**Tech Stack:** Next.js App Router (server actions), React 18 con `useTransition`, zod para validar la respuesta del producto, vitest, Tailwind + los componentes de `src/core/ui/`.

**Spec:** `docs/superpowers/specs/2026-09-02-equipos-y-plan-en-el-back-office-design.md` (vive en `raven-nest`, junto a este plan; el código de este plan es para el otro repo)

**Repo de trabajo:** `C:\Users\gerod\RavenProjects\aira-admin` — repo **de Lucas** (`aira-org/aira-admin`, privado). El trabajo va por **PR**, no directo a `main`.

**Antes de la Task 1**, desde ese repo: `git checkout main && git pull && git checkout -b feat/nest-plan-y-equipos`. Todas las tareas commitean ahí.

## Global Constraints

- **El contrato ya está deployado, verificado y andando.** No hay que tocar `raven-nest` en este plan. Las rutas existen en producción y devuelven lo que este plan asume.
- **El envelope del contrato es `{ ok: true, ...datos }`.** El `ProductClient` descarta toda respuesta sin `ok: true`; los datos van bajo su propia clave (`equipos`, `equipo`, `cambios`). Esto se arregló del lado de Nest el 2026-09-02 (`b22b147`) — antes el back-office no podía leer nada.
- **La verificación que prueba el contrato es correr el `ProductClient` real contra la function real**, no `curl`. Receta al final del plan.
- **Permiso para todo lo de este plan: `acciones:ejecutar`**, que ya existe y tienen los roles Dueño y Soporte. **No se agrega ningún permiso nuevo** y no se toca `src/core/rbac/`.
- El chequeo de permiso va **dos veces**: se esconde el control en la UI y se vuelve a exigir dentro de cada server action. No es redundante — una server action es un endpoint HTTP y se puede invocar a mano.
- **Toda escritura pide motivo** (`DialogMotivo`, mínimo 5 caracteres) y registra un evento con `registrarEvento` además de lo que audita el producto. Son dos preguntas distintas: "¿qué le pasó a esta cuenta?" la responde Nest, "¿qué hizo Fulano?" la responde el admin, y la segunda tiene que sobrevivir a que Nest se apague.
- **`auditado: false` en una respuesta del producto no es un error.** Significa que la acción se aplicó pero Nest no pudo escribir su fila de auditoría. Se muestra como advertencia sobre la acción realizada.
- Tests: `npm test` (vitest). **La barra es el exit code**, no el conteo. El CI de Lucas corre además `npm run lint` (bloqueante), `npm run typecheck` y `npm run build`: los cuatro tienen que pasar antes del PR.
- Español para comentarios, textos de UI y mensajes de commit. La UI del back-office está en español (a diferencia de la app de Nest, que es en inglés).
- **`src/products/` no tiene tests hoy** y este plan no los agrega: los paneles se verifican en el navegador. Lo testeado es el core (schemas, client, labels).

---

### Task 1: Los schemas de la respuesta de equipos

**Files:**
- Modify: `src/core/products/schemas.ts`
- Test: `src/core/products/schemas.test.ts`

**Interfaces:**
- Consumes: nada.
- Produce: `equipoSchema`, `miembroEquipoSchema`, `repoEquipoSchema` y los tipos `Equipo`, `MiembroEquipo`, `RepoEquipo`. La Task 2 los usa para parsear; las Tasks 5 y 6 los usan como tipos de props.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `src/core/products/schemas.test.ts`:

```typescript
import { equipoSchema } from "./schemas";

const EQUIPO = {
  id: "c58ff57a-d6d6-49a2-a539-b30b6d51632e",
  name: "STI-PROJECTS",
  creado: "2026-05-01T10:00:00.000Z",
  es_dueno: true,
  dueno: { id: "10663452-fd04-401f-8e92-f5927f503703", email: "gero@nestmux.com" },
  miembros: [
    {
      id: "m1",
      user_id: "10663452-fd04-401f-8e92-f5927f503703",
      email: "gero@nestmux.com",
      role: "leader",
      status: "active",
      es_dueno: true,
      invitado: null,
      acepto: "2026-05-01T10:00:00.000Z",
    },
  ],
  repos: [{ full_name: "gero/nest", provider: "github", agregado: "2026-06-01T10:00:00.000Z" }],
  mensajes: 3,
};

describe("equipoSchema", () => {
  it("parsea un equipo real del contrato", () => {
    const e = equipoSchema.parse(EQUIPO);
    expect(e.name).toBe("STI-PROJECTS");
    expect(e.miembros[0].es_dueno).toBe(true);
    expect(e.repos[0].full_name).toBe("gero/nest");
  });

  // La FK de team_members.user_id es ON DELETE SET NULL: la fila sobrevive a la
  // cuenta y sigue ocupando un seat. Es justo la que hay que poder sacar.
  it("acepta un miembro cuya cuenta se borró", () => {
    const e = equipoSchema.parse({
      ...EQUIPO,
      miembros: [{ ...EQUIPO.miembros[0], user_id: null, es_dueno: false }],
    });
    expect(e.miembros[0].user_id).toBeNull();
  });

  it("acepta un equipo sin miembros ni repos", () => {
    const e = equipoSchema.parse({ ...EQUIPO, miembros: [], repos: [], mensajes: 0 });
    expect(e.miembros).toEqual([]);
  });

  it("acepta una invitación pendiente", () => {
    const e = equipoSchema.parse({
      ...EQUIPO,
      miembros: [{ ...EQUIPO.miembros[0], status: "pending", acepto: null, invitado: "2026-05-02T10:00:00.000Z" }],
    });
    expect(e.miembros[0].status).toBe("pending");
  });

  // El producto normaliza role y status antes de mandarlos; un valor fuera de
  // los dos posibles es un cambio de contrato y tiene que fallar con un mensaje
  // de parseo, no dibujarse como si nada.
  it("rechaza un rol que el contrato no define", () => {
    expect(() =>
      equipoSchema.parse({ ...EQUIPO, miembros: [{ ...EQUIPO.miembros[0], role: "admin" }] }),
    ).toThrow();
  });

  it("rechaza un equipo sin dueño", () => {
    const { dueno: _, ...sinDueno } = EQUIPO;
    expect(() => equipoSchema.parse(sinDueno)).toThrow();
  });

  it("el conteo de mensajes es número, no string", () => {
    expect(() => equipoSchema.parse({ ...EQUIPO, mensajes: "3" })).toThrow();
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run src/core/products/schemas.test.ts
```

Esperado: FAIL — `equipoSchema` no existe.

- [ ] **Step 3: Implementar**

Agregar a `src/core/products/schemas.ts`, después de `accountDetailSchema`:

```typescript
/**
 * Un equipo de Nest, tal como lo serializa `GET /api/internal/accounts/:id/equipos`.
 *
 * La propiedad del equipo la define `dueno`, que del lado del producto sale de
 * `teams.owner_id`. **No se deduce del `role`**: hay equipos reales con cuatro
 * miembros marcados `leader` y un solo dueño.
 */
export const miembroEquipoSchema = z.object({
  /** Id de la fila de membresía, no del usuario: es lo que se manda para sacarlo. */
  id: z.string(),
  /** `null` cuando la cuenta se borró; la fila sobrevive y sigue ocupando un seat. */
  user_id: z.string().nullable(),
  email: z.string().nullable(),
  role: z.enum(["leader", "member"]),
  status: z.enum(["active", "pending"]),
  es_dueno: z.boolean(),
  invitado: z.string().nullable(),
  acepto: z.string().nullable(),
});

export const repoEquipoSchema = z.object({
  full_name: z.string(),
  provider: z.string().nullable(),
  agregado: z.string().nullable(),
});

export const equipoSchema = z.object({
  id: z.string(),
  name: z.string(),
  creado: z.string().nullable(),
  /** El usuario de la ficha es el dueño de este equipo. */
  es_dueno: z.boolean(),
  dueno: z.object({ id: z.string(), email: z.string().nullable() }),
  miembros: z.array(miembroEquipoSchema),
  repos: z.array(repoEquipoSchema),
  /** Conteo. El contenido de los mensajes no sale del producto. */
  mensajes: z.number(),
});
```

Y al final del archivo, con los otros tipos:

```typescript
export type MiembroEquipo = z.infer<typeof miembroEquipoSchema>;
export type RepoEquipo = z.infer<typeof repoEquipoSchema>;
export type Equipo = z.infer<typeof equipoSchema>;
```

- [ ] **Step 4: Correr y verificar que pasan**

```bash
npx vitest run src/core/products/schemas.test.ts; echo "exit: $?"
```

Esperado: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/products/schemas.ts src/core/products/schemas.test.ts
git commit -m "feat(core): schemas de los equipos que expone Nest"
```

---

### Task 2: Los cuatro métodos del ProductClient

**Files:**
- Modify: `src/core/products/client.ts`
- Test: `src/core/products/client.test.ts`

**Interfaces:**
- Consumes: `equipoSchema` y el tipo `Equipo` (Task 1).
- Produce: `cambiarPlan(id, plan, motivo)`, `equiposDe(id)`, `sacarMiembro(teamId, memberId, motivo)`, `transferirEquipo(teamId, ownerId, motivo)`. Los tipos de retorno están abajo; la Task 4 los llama desde las server actions.

**Ojo con esto:** `pedir()` acepta hoy `"GET" | "PUT" | "POST"`. Sacar un miembro es un `DELETE` y hay que agregarlo al tipo. Es el único cambio no-aditivo del plan, y es de una palabra.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `src/core/products/client.test.ts`, dentro del `describe("ProductClient", ...)`:

```typescript
  const EQUIPO = {
    id: "t1",
    name: "STI-PROJECTS",
    creado: "2026-05-01T10:00:00.000Z",
    es_dueno: true,
    dueno: { id: "u1", email: "gero@nestmux.com" },
    miembros: [
      { id: "m1", user_id: "u1", email: "gero@nestmux.com", role: "leader", status: "active", es_dueno: true, invitado: null, acepto: null },
      { id: "m2", user_id: "u2", email: "otro@nestmux.com", role: "member", status: "active", es_dueno: false, invitado: null, acepto: null },
    ],
    repos: [],
    mensajes: 0,
  };

  it("cambiarPlan: PUT con el plan en el body y el motivo en el header", async () => {
    const spy = mockFetch(json({ ok: true, cambios: [{ key: "plan", de: "free", a: "team" }] }));
    const r = await new ProductClient(ref, actor).cambiarPlan("c1", "team", "pasa a pago");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://app.airamed.io/api/internal/accounts/c1/plan");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ plan: "team" });
    expect(new Headers(init.headers).get("x-admin-motivo")).toBe("pasa a pago");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.cambios).toEqual([{ key: "plan", de: "free", a: "team" }]);
    expect(r.data.auditado).toBe(true);
  });

  // `auditado: false` significa que el cambio se aplicó pero el producto no pudo
  // registrar quién ni por qué. No es un error: es la única señal de eso.
  it("cambiarPlan: propaga auditado false sin volverlo un error", async () => {
    mockFetch(json({ ok: true, cambios: [], auditado: false }));
    const r = await new ProductClient(ref, actor).cambiarPlan("c1", "pro", "x");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.auditado).toBe(false);
  });

  it("cambiarPlan: sin motivo no sale de acá", async () => {
    const spy = mockFetch(json({ ok: true, cambios: [] }));
    const r = await new ProductClient(ref, actor).cambiarPlan("c1", "team", "   ");
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("equiposDe: GET sin motivo, y parsea la lista", async () => {
    const spy = mockFetch(json({ ok: true, equipos: [EQUIPO] }));
    const r = await new ProductClient(ref, actor).equiposDe("c1");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://app.airamed.io/api/internal/accounts/c1/equipos");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("x-admin-motivo")).toBeNull();
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].miembros[1].email).toBe("otro@nestmux.com");
  });

  it("sacarMiembro: DELETE a la ruta del miembro y devuelve el equipo actualizado", async () => {
    const spy = mockFetch(json({ ok: true, equipo: EQUIPO }));
    const r = await new ProductClient(ref, actor).sacarMiembro("t1", "m2", "se fue del equipo");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://app.airamed.io/api/internal/equipos/t1/miembros/m2");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("x-admin-motivo")).toBe("se fue del equipo");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.equipo?.name).toBe("STI-PROJECTS");
  });

  // El producto responde `equipo: null` si el equipo desapareció entre la
  // escritura y la relectura. La acción ocurrió igual, así que no es un error.
  it("sacarMiembro: acepta equipo null", async () => {
    mockFetch(json({ ok: true, equipo: null }));
    const r = await new ProductClient(ref, actor).sacarMiembro("t1", "m2", "motivo");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.equipo).toBeNull();
  });

  it("transferirEquipo: PUT con owner_id y devuelve los cambios", async () => {
    const spy = mockFetch(
      json({ ok: true, equipo: EQUIPO, cambios: [{ key: "owner", de: "u1", a: "u2" }] }),
    );
    const r = await new ProductClient(ref, actor).transferirEquipo("t1", "u2", "el dueño se va");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://app.airamed.io/api/internal/equipos/t1/owner");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ owner_id: "u2" });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.cambios).toEqual([{ key: "owner", de: "u1", a: "u2" }]);
  });

  // 409 del producto: el equipo no tiene a quién transferirle. El mensaje del
  // producto es el que ve el operador, así que tiene que llegar entero.
  it("transferirEquipo: pasa el mensaje del producto tal cual", async () => {
    mockFetch(
      json({ error: "El equipo no tiene otro miembro activo al que transferirle la propiedad" }, 409),
    );
    const r = await new ProductClient(ref, actor).transferirEquipo("t1", "u2", "motivo");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("El equipo no tiene otro miembro activo al que transferirle la propiedad");
    expect(r.status).toBe(409);
  });
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run src/core/products/client.test.ts
```

Esperado: FAIL — los cuatro métodos no existen.

- [ ] **Step 3: Implementar**

En `client.ts`, primero agregar `DELETE` al tipo del método (dos lugares: la firma de `pedir` y el chequeo de motivo ya cubre todo lo que no sea GET):

```typescript
  private async pedir<T>(
    metodo: "GET" | "PUT" | "POST" | "DELETE",
```

Sumar `equipoSchema` y el tipo `Equipo` a los imports de `./schemas`. Después, al final de la clase:

```typescript
  /**
   * Cambia el plan de una cuenta.
   *
   * **No toca Stripe**: escribe el plan en el producto y nada más, que es lo
   * mismo que hacía la herramienta que este panel reemplaza. Si la cuenta tiene
   * una suscripción viva, sigue viva y sigue cobrando.
   */
  cambiarPlan(
    id: string,
    plan: string,
    motivo: string,
  ): Promise<Resultado<{ cambios: CambioPlan[]; auditado: boolean }>> {
    return this.pedir(
      "PUT",
      `/api/internal/accounts/${id}/plan`,
      (c) => ({
        cambios: z.array(cambioPlanSchema).parse(c.cambios),
        // Ausente = se auditó. Sólo viaja cuando NO se pudo.
        auditado: c.auditado !== false,
      }),
      { motivo, body: { plan } },
    );
  }

  /** Los equipos donde la cuenta es dueña o miembro. Lectura: no pide motivo. */
  equiposDe(id: string): Promise<Resultado<Equipo[]>> {
    return this.pedir("GET", `/api/internal/accounts/${id}/equipos`, (c) =>
      z.array(equipoSchema).parse(c.equipos),
    );
  }

  /**
   * Saca un miembro de un equipo, o cancela una invitación pendiente: son la
   * misma fila del otro lado.
   *
   * `equipo` puede venir en `null` si el equipo dejó de existir entre la baja y
   * la relectura. La baja ocurrió igual, así que no es un error: la pantalla
   * tiene que recargar en vez de mostrar un fallo.
   */
  sacarMiembro(
    teamId: string,
    memberId: string,
    motivo: string,
  ): Promise<Resultado<{ equipo: Equipo | null; auditado: boolean }>> {
    return this.pedir(
      "DELETE",
      `/api/internal/equipos/${teamId}/miembros/${memberId}`,
      (c) => ({
        equipo: c.equipo == null ? null : equipoSchema.parse(c.equipo),
        auditado: c.auditado !== false,
      }),
      { motivo },
    );
  }

  /**
   * Pasa la propiedad de un equipo a otro de sus miembros activos.
   *
   * El dueño saliente **queda como miembro**: la transferencia no le saca el
   * acceso a nadie ni cambia cuántos seats se facturan.
   */
  transferirEquipo(
    teamId: string,
    ownerId: string,
    motivo: string,
  ): Promise<Resultado<{ equipo: Equipo | null; cambios: CambioOwner[]; auditado: boolean }>> {
    return this.pedir(
      "PUT",
      `/api/internal/equipos/${teamId}/owner`,
      (c) => ({
        equipo: c.equipo == null ? null : equipoSchema.parse(c.equipo),
        cambios: z.array(cambioOwnerSchema).parse(c.cambios),
        auditado: c.auditado !== false,
      }),
      { motivo, body: { owner_id: ownerId } },
    );
  }
```

Los dos schemas de cambios y sus tipos van arriba del archivo, junto a los otros imports de zod (o en `schemas.ts` si preferís tenerlos con el resto — mantenelos en un solo lugar):

```typescript
const cambioPlanSchema = z.object({
  key: z.literal("plan"),
  de: z.string().nullable(),
  a: z.string(),
});
const cambioOwnerSchema = z.object({
  key: z.literal("owner"),
  de: z.string(),
  a: z.string(),
});
export type CambioPlan = z.infer<typeof cambioPlanSchema>;
export type CambioOwner = z.infer<typeof cambioOwnerSchema>;
```

- [ ] **Step 4: Correr y verificar que pasan**

```bash
npx vitest run src/core/products/; echo "exit: $?"
```

Esperado: PASS, exit 0, con los tests que ya existían.

- [ ] **Step 5: Commit**

```bash
git add src/core/products/client.ts src/core/products/client.test.ts
git commit -m "feat(core): metodos de plan y equipos en el ProductClient"
```

---

### Task 3: Las etiquetas del audit

**Files:**
- Modify: `src/core/audit/acciones-labels.ts`
- Test: `src/core/audit/acciones-labels.test.ts`

**Interfaces:**
- Consumes: nada.
- Produce: las acciones `plan.cambiado`, `equipo.miembro_sacado` y `equipo.transferido` con etiqueta. La Task 4 las usa como `action` al registrar eventos.

Sin esto las tres acciones se muestran en su forma técnica en el historial y no aparecen en el filtro (`ACCIONES_CONOCIDAS` lo arma desde este mapa).

- [ ] **Step 1: Escribir el test que falla**

Agregar en `acciones-labels.test.ts`, dentro del `describe`:

```typescript
  it("traduce las acciones de Nest", () => {
    expect(etiquetaAccion("plan.cambiado")).toBe("Cambió el plan");
    expect(etiquetaAccion("equipo.miembro_sacado")).toBe("Sacó a un miembro de un equipo");
    expect(etiquetaAccion("equipo.transferido")).toBe("Transfirió un equipo");
  });

  it("las acciones de Nest entran al filtro", () => {
    expect(ACCIONES_CONOCIDAS).toContain("plan.cambiado");
    expect(ACCIONES_CONOCIDAS).toContain("equipo.transferido");
  });
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run src/core/audit/acciones-labels.test.ts
```

Esperado: FAIL — `etiquetaAccion` devuelve la acción cruda.

- [ ] **Step 3: Implementar**

Agregar al mapa `ETIQUETAS`, después de las de AiraMed:

```typescript
  // Nest
  "plan.cambiado": "Cambió el plan",
  "equipo.miembro_sacado": "Sacó a un miembro de un equipo",
  "equipo.transferido": "Transfirió un equipo",
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run src/core/audit/; echo "exit: $?"
```

Esperado: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/audit/acciones-labels.ts src/core/audit/acciones-labels.test.ts
git commit -m "feat(audit): etiquetas de las acciones de Nest"
```

---

### Task 4: Las server actions de Nest

**Files:**
- Create: `src/products/nest/planes.ts`
- Create: `src/products/nest/acciones.ts`

**Interfaces:**
- Consumes: los cuatro métodos del `ProductClient` (Task 2), las acciones del audit (Task 3).
- Produce: `PLANES` (desde `planes.ts`), y `cambiarPlanDeCuenta`, `listarEquipos`, `sacarMiembroDeEquipo`, `transferirPropiedad` más sus tipos de resultado (desde `acciones.ts`). Los paneles (Tasks 5 y 6) consumen ambos.

Este archivo es el único de `products/nest/` que corre en el servidor. Copia el patrón de `src/products/airamed/acciones.ts` exactamente: `exigirPermiso` → `productoPorSlug` → `ProductClient` → `registrarEvento` → `revalidatePath`.

**Por qué `PLANES` va en su propio archivo:** un módulo `"use server"` sólo puede exportar **funciones async**. Exportar una constante desde ahí rompe el build de Next, y el panel de la Task 5 necesita la lista para dibujar los botones. Los `type` sí pueden quedarse en `acciones.ts`: desaparecen al compilar.

- [ ] **Step 1: Crear la lista de planes**

Crear `src/products/nest/planes.ts`:

```typescript
/**
 * Planes que Nest cobra, para el selector del panel.
 *
 * Van acá y no en `acciones.ts` porque ese archivo es `"use server"` y sólo
 * puede exportar funciones async. Y van hardcodeados y no en el manifest porque
 * el manifest del contrato no tiene dónde declararlos: si Nest suma un tier, se
 * toca esta lista.
 *
 * `enterprise` no es self-serve del lado de Nest —no tiene precio en Stripe— así
 * que asignarlo desde acá es la única forma de darlo de alta.
 */
export const PLANES = [
  { valor: "free", label: "Free" },
  { valor: "pro", label: "Pro" },
  { valor: "team", label: "Team" },
  { valor: "enterprise", label: "Enterprise" },
] as const;
```

- [ ] **Step 2: Implementar las acciones**

Crear `src/products/nest/acciones.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/core/rbac/guard";
import { productoPorSlug } from "@/core/products/registry";
import { ProductClient } from "@/core/products/client";
import { registrarEvento } from "@/core/audit/eventos";
import type { Equipo } from "@/core/products/schemas";
import { PLANES } from "./planes";

/**
 * `auditado` viaja hasta la pantalla en cada escritura.
 *
 * `false` significa que el cambio se aplicó pero Nest no pudo registrar quién ni
 * por qué. No es un error —la acción ocurrió— pero el operador tiene que verlo:
 * es la única señal de que quedó una escritura sin rastro del lado del producto.
 */
export type ResultadoEscritura = { error: string } | { ok: true; auditado: boolean };
export type ResultadoEquipos = { error: string } | { ok: true; equipos: Equipo[] };
export type ResultadoEquipo =
  | { error: string }
  | { ok: true; equipo: Equipo | null; auditado: boolean };

export async function cambiarPlanDeCuenta(
  slug: string,
  cuentaId: string,
  cuentaNombre: string,
  plan: string,
  motivo: string,
): Promise<ResultadoEscritura> {
  // No es redundante con esconder el selector: una server action es un endpoint
  // HTTP y se puede invocar a mano.
  const actor = await exigirPermiso("acciones:ejecutar", slug);
  const ref = productoPorSlug(slug);
  if (!ref) return { error: "Producto desconocido." };
  if (!PLANES.some((p) => p.valor === plan)) return { error: "Ese plan no existe." };

  const r = await new ProductClient(ref, { id: actor.id, email: actor.email }).cambiarPlan(
    cuentaId,
    plan,
    motivo,
  );
  if (!r.ok) return { error: r.error };

  await registrarEvento({
    actor,
    productSlug: slug,
    accountId: cuentaId,
    accountLabel: cuentaNombre,
    action: "plan.cambiado",
    motivo,
    metadata: { cambios: r.data.cambios },
  });

  revalidatePath(`/p/${slug}/cuentas/${cuentaId}`);
  return { ok: true, auditado: r.data.auditado };
}

/** Lectura: no pide motivo y no registra evento. */
export async function listarEquipos(slug: string, cuentaId: string): Promise<ResultadoEquipos> {
  const actor = await exigirPermiso("cuentas:leer", slug);
  const ref = productoPorSlug(slug);
  if (!ref) return { error: "Producto desconocido." };

  const r = await new ProductClient(ref, { id: actor.id, email: actor.email }).equiposDe(cuentaId);
  return r.ok ? { ok: true, equipos: r.data } : { error: r.error };
}

export async function sacarMiembroDeEquipo(
  slug: string,
  cuentaId: string,
  cuentaNombre: string,
  teamId: string,
  memberId: string,
  emailMiembro: string | null,
  motivo: string,
): Promise<ResultadoEquipo> {
  const actor = await exigirPermiso("acciones:ejecutar", slug);
  const ref = productoPorSlug(slug);
  if (!ref) return { error: "Producto desconocido." };

  const r = await new ProductClient(ref, { id: actor.id, email: actor.email }).sacarMiembro(
    teamId,
    memberId,
    motivo,
  );
  if (!r.ok) return { error: r.error };

  await registrarEvento({
    actor,
    productSlug: slug,
    accountId: cuentaId,
    accountLabel: cuentaNombre,
    action: "equipo.miembro_sacado",
    motivo,
    // El equipo por id y el miembro por email: es lo que hace legible el
    // historial sin guardar nada que no haga falta.
    metadata: { equipo: teamId, miembro: emailMiembro },
  });

  revalidatePath(`/p/${slug}/cuentas/${cuentaId}`);
  return { ok: true, equipo: r.data.equipo, auditado: r.data.auditado };
}

export async function transferirPropiedad(
  slug: string,
  cuentaId: string,
  cuentaNombre: string,
  teamId: string,
  nuevoOwnerId: string,
  emailNuevoOwner: string | null,
  motivo: string,
): Promise<ResultadoEquipo> {
  const actor = await exigirPermiso("acciones:ejecutar", slug);
  const ref = productoPorSlug(slug);
  if (!ref) return { error: "Producto desconocido." };

  const r = await new ProductClient(ref, { id: actor.id, email: actor.email }).transferirEquipo(
    teamId,
    nuevoOwnerId,
    motivo,
  );
  if (!r.ok) return { error: r.error };

  await registrarEvento({
    actor,
    productSlug: slug,
    accountId: cuentaId,
    accountLabel: cuentaNombre,
    action: "equipo.transferido",
    motivo,
    metadata: { equipo: teamId, nuevo_dueno: emailNuevoOwner, cambios: r.data.cambios },
  });

  revalidatePath(`/p/${slug}/cuentas/${cuentaId}`);
  return { ok: true, equipo: r.data.equipo, auditado: r.data.auditado };
}
```

- [ ] **Step 2: Verificar que compila y que la suite sigue verde**

```bash
npm run typecheck && npx vitest run; echo "exit: $?"
```

Esperado: typecheck limpio y la suite en verde. Si `registrarEvento` pide algún campo que falte, leé su firma en `src/core/audit/eventos.ts` y completalo — no inventes campos nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/products/nest/acciones.ts
git commit -m "feat(nest): server actions de plan y equipos"
```

---

### Task 5: El panel de plan

**Files:**
- Create: `src/products/nest/PanelPlan.tsx`

**Interfaces:**
- Consumes: `cambiarPlanDeCuenta` y `PLANES` (Task 4), `PropsSeccion` del core.
- Produce: el componente `PanelPlan`, que la Task 7 registra como `nest/plan`.

No necesita cargar nada: el plan actual ya viene en `cuenta.plan` y `cuenta.plan_label`.

- [ ] **Step 1: Implementar**

Crear `src/products/nest/PanelPlan.tsx`. Seguí las clases y la estructura de `src/products/airamed/PanelGrabaciones.tsx` para que se vea igual que el resto:

```tsx
"use client";

import { useState } from "react";
import type { PropsSeccion } from "@/core/products/secciones";
import { Alert, AlertDescription } from "@/core/ui/alert";
import { Button } from "@/core/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { DialogMotivo } from "@/core/ui/DialogMotivo";
import { cambiarPlanDeCuenta } from "./acciones";
import { PLANES } from "./planes";

/**
 * Plan de una cuenta de Nest.
 *
 * **Cambiar el plan acá no toca Stripe.** Escribe el plan en el producto y nada
 * más: si la cuenta tiene una suscripción viva, sigue viva y sigue cobrando, y
 * si no la tiene, pasarla a Team no genera ninguna. Es lo mismo que hacía la
 * herramienta que este panel reemplaza, y por eso los planes de pago que hay hoy
 * no tienen suscripción detrás. El cartel lo dice en la pantalla, porque es
 * exactamente lo que alguien podría suponer al revés.
 */
export function PanelPlan({ slug, cuenta, permisos }: PropsSeccion) {
  const [elegido, setElegido] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const puede = permisos.acciones;

  const destino = PLANES.find((p) => p.valor === elegido);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <CardDescription>
          Cambiar el plan acá no crea ni cancela suscripciones de Stripe: sólo cambia el plan de la
          cuenta.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-sm">
          Plan actual: <span className="font-medium">{cuenta.plan_label}</span>
        </p>

        {aviso ? (
          <Alert>
            <AlertDescription>{aviso}</AlertDescription>
          </Alert>
        ) : null}

        {!puede ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            No tenés permiso para cambiar el plan.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {PLANES.filter((p) => p.valor !== cuenta.plan).map((p) => (
              <Button
                key={p.valor}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAviso(null);
                  setElegido(p.valor);
                }}
              >
                Pasar a {p.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>

      <DialogMotivo
        abierto={destino !== undefined}
        onCerrar={() => setElegido(null)}
        titulo="Cambiar el plan"
        resumen={`${cuenta.name}: ${cuenta.plan_label} → ${destino?.label ?? ""}`}
        descripcion="No se toca Stripe. Si la cuenta tiene una suscripción, sigue como está."
        textoConfirmar="Cambiar el plan"
        onConfirmar={async (motivo) => {
          if (!destino) return;
          const r = await cambiarPlanDeCuenta(slug, cuenta.id, cuenta.name, destino.valor, motivo);
          if ("error" in r) return { error: r.error };
          setElegido(null);
          setAviso(
            r.auditado
              ? `Plan cambiado a ${destino.label}.`
              : `Plan cambiado a ${destino.label}, pero Nest no pudo registrar la auditoría de su lado.`,
          );
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
npm run typecheck && npm run lint; echo "exit: $?"
```

Esperado: limpio. Si `DialogMotivo` espera otra forma de `onConfirmar`, leé su firma en `src/core/ui/DialogMotivo.tsx` y adaptá la llamada — no cambies el componente del core.

- [ ] **Step 3: Commit**

```bash
git add src/products/nest/PanelPlan.tsx
git commit -m "feat(nest): panel para cambiar el plan de una cuenta"
```

---

### Task 6: El panel de equipos

**Files:**
- Create: `src/products/nest/PanelEquipos.tsx`

**Interfaces:**
- Consumes: `listarEquipos`, `sacarMiembroDeEquipo`, `transferirPropiedad` (Task 4); `Equipo` y `MiembroEquipo` (Task 1).
- Produce: el componente `PanelEquipos`, que la Task 7 registra como `nest/equipos`.

**Carga con botón, no sola.** La ficha ya muestra `teams` y `seats` en sus meters, así que el operador sabe si hay equipos sin pedir nada; este panel es para ver el detalle. Además cada carga son varias consultas del lado del producto. Es la misma decisión que tomó `PanelGrabaciones` y por las mismas razones.

- [ ] **Step 1: Implementar**

Crear `src/products/nest/PanelEquipos.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import type { PropsSeccion } from "@/core/products/secciones";
import type { Equipo, MiembroEquipo } from "@/core/products/schemas";
import { Alert, AlertDescription } from "@/core/ui/alert";
import { Button } from "@/core/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { DialogMotivo } from "@/core/ui/DialogMotivo";
import { listarEquipos, sacarMiembroDeEquipo, transferirPropiedad } from "./acciones";

type Pedido =
  | { tipo: "sacar"; equipo: Equipo; miembro: MiembroEquipo }
  | { tipo: "transferir"; equipo: Equipo };

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * Equipos de una cuenta de Nest: quiénes son, qué repos comparten, y las dos
 * acciones que de otro modo obligan a entrar a la base a mano.
 *
 * Dos cosas del modelo que la pantalla tiene que respetar:
 *
 * 1. **El dueño lo define `dueno`, no el rol.** Hay equipos con cuatro miembros
 *    marcados `leader` y un solo dueño, así que el rol no se usa para decidir
 *    quién manda: se muestra como dato y nada más.
 * 2. **Al dueño no se lo puede sacar.** Dejaría el equipo apuntando a alguien
 *    que ya no está en él. Para eso está transferir.
 */
export function PanelEquipos({ slug, cuenta, permisos }: PropsSeccion) {
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, cargar] = useTransition();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [nuevoOwner, setNuevoOwner] = useState<string>("");

  const puede = permisos.acciones;

  function traer() {
    setError(null);
    cargar(async () => {
      const r = await listarEquipos(slug, cuenta.id);
      if ("error" in r) {
        setError(r.error);
        setEquipos(null);
        return;
      }
      setEquipos(r.equipos);
    });
  }

  /** Los que pueden recibir la propiedad: activos, con cuenta viva, y no el dueño. */
  const candidatos = (e: Equipo) =>
    e.miembros.filter((m) => m.status === "active" && m.user_id !== null && !m.es_dueno);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Equipos</CardTitle>
            <CardDescription>
              Los equipos donde esta cuenta es dueña o miembro, con sus repos compartidos.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={traer} disabled={cargando}>
            <RefreshCw className={`size-3.5 ${cargando ? "animate-spin" : ""}`} />
            {equipos === null ? "Ver equipos" : "Actualizar"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {aviso ? (
          <Alert>
            <AlertDescription>{aviso}</AlertDescription>
          </Alert>
        ) : null}

        {equipos !== null && equipos.length === 0 ? (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Esta cuenta no participa de ningún equipo.
          </p>
        ) : null}

        {equipos?.map((e) => (
          <div key={e.id} className="rounded-md border">
            <div className="flex items-start justify-between gap-3 border-b p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{e.name}</p>
                <p className="text-xs text-muted-foreground">
                  {e.es_dueno ? "Es la dueña" : `Dueño: ${e.dueno.email ?? e.dueno.id}`} ·{" "}
                  {e.miembros.length} {e.miembros.length === 1 ? "miembro" : "miembros"} ·{" "}
                  {e.repos.length} {e.repos.length === 1 ? "repo" : "repos"} · creado {fecha(e.creado)}
                </p>
              </div>
              {puede && candidatos(e).length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAviso(null);
                    setNuevoOwner(candidatos(e)[0].user_id ?? "");
                    setPedido({ tipo: "transferir", equipo: e });
                  }}
                >
                  Transferir
                </Button>
              ) : null}
            </div>

            <ul className="divide-y">
              {e.miembros.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {m.email ?? "(sin email)"}
                      {m.es_dueno ? <span className="text-muted-foreground"> · dueño</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.role === "leader" ? "Leader" : "Member"}
                      {m.status === "pending" ? " · invitación pendiente" : ""}
                      {m.user_id === null ? " · la cuenta ya no existe" : ""}
                    </p>
                  </div>
                  {puede && !m.es_dueno ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAviso(null);
                        setPedido({ tipo: "sacar", equipo: e, miembro: m });
                      }}
                    >
                      {m.status === "pending" ? "Cancelar invitación" : "Sacar"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>

            {e.repos.length > 0 ? (
              <div className="border-t p-3">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Repos compartidos</p>
                <ul className="space-y-0.5">
                  {e.repos.map((r) => (
                    <li key={r.full_name} className="font-mono text-xs text-muted-foreground">
                      {r.full_name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>

      <DialogMotivo
        abierto={pedido !== null}
        onCerrar={() => setPedido(null)}
        titulo={pedido?.tipo === "transferir" ? "Transferir el equipo" : "Sacar del equipo"}
        resumen={
          pedido?.tipo === "transferir"
            ? `${pedido.equipo.name}: la propiedad pasa a otro miembro. El dueño actual queda como miembro.`
            : pedido
              ? `${pedido.miembro.email ?? pedido.miembro.id} sale de ${pedido.equipo.name}`
              : ""
        }
        textoConfirmar={pedido?.tipo === "transferir" ? "Transferir" : "Sacar"}
        destructivo={pedido?.tipo === "sacar"}
        onConfirmar={async (motivo) => {
          if (!pedido) return;
          const r =
            pedido.tipo === "transferir"
              ? await transferirPropiedad(
                  slug,
                  cuenta.id,
                  cuenta.name,
                  pedido.equipo.id,
                  nuevoOwner,
                  candidatos(pedido.equipo).find((m) => m.user_id === nuevoOwner)?.email ?? null,
                  motivo,
                )
              : await sacarMiembroDeEquipo(
                  slug,
                  cuenta.id,
                  cuenta.name,
                  pedido.equipo.id,
                  pedido.miembro.id,
                  pedido.miembro.email,
                  motivo,
                );
          if ("error" in r) return { error: r.error };

          // El producto devuelve el equipo actualizado. Si vino en `null` es que
          // dejó de existir: se recarga la lista entera en vez de dibujar un
          // equipo que ya no está.
          if (r.equipo) {
            setEquipos((prev) => prev?.map((e) => (e.id === r.equipo!.id ? r.equipo! : e)) ?? null);
          } else {
            traer();
          }
          setPedido(null);
          setAviso(
            r.auditado
              ? "Listo."
              : "Se aplicó el cambio, pero Nest no pudo registrar la auditoría de su lado.",
          );
        }}
      >
        {pedido?.tipo === "transferir" ? (
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="nuevo-owner">
              Nuevo dueño
            </label>
            <select
              id="nuevo-owner"
              className="w-full rounded-md border bg-background p-2 text-sm"
              value={nuevoOwner}
              onChange={(ev) => setNuevoOwner(ev.target.value)}
            >
              {candidatos(pedido.equipo).map((m) => (
                <option key={m.id} value={m.user_id ?? ""}>
                  {m.email ?? m.user_id}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </DialogMotivo>
    </Card>
  );
}
```

- [ ] **Step 2: Verificar que compila**

```bash
npm run typecheck && npm run lint; echo "exit: $?"
```

Esperado: limpio.

- [ ] **Step 3: Commit**

```bash
git add src/products/nest/PanelEquipos.tsx
git commit -m "feat(nest): panel de equipos con sacar miembro y transferir"
```

---

### Task 7: Registrar los paneles, verificar entero y abrir el PR

**Files:**
- Modify: `src/products/registro.ts`

**Interfaces:**
- Consumes: `PanelPlan` (Task 5) y `PanelEquipos` (Task 6).
- Produce: el back-office dibujando las dos secciones que el manifest de Nest declara.

- [ ] **Step 1: Registrar**

En `src/products/registro.ts`, agregar los imports y las dos entradas:

```typescript
import { PanelPlan } from "./nest/PanelPlan";
import { PanelEquipos } from "./nest/PanelEquipos";
```

```typescript
export const REGISTRO_SECCIONES: RegistroSecciones = {
  "airamed/voz": VapiConfigForm,
  "airamed/whatsapp": PanelWhatsapp,
  "airamed/grabaciones": PanelGrabaciones,
  "nest/plan": PanelPlan,
  "nest/equipos": PanelEquipos,
};
```

- [ ] **Step 2: Correr lo mismo que corre el CI de Lucas**

```bash
npm run lint && npm run typecheck && npm test && npm run build; echo "exit: $?"
```

Esperado: los cuatro en verde, exit 0. **El lint es bloqueante en su CI**: un error frena el merge.

- [ ] **Step 3: 🚦 Verificar contra el contrato real, no contra mocks**

Los tests de las Tasks 1-3 usan respuestas mockeadas. Lo que prueba que el contrato encaja de verdad es correr el `ProductClient` contra la function deployada. Crear un archivo temporal, correrlo, **y borrarlo** (no se commitea):

```typescript
// src/core/products/__prueba.test.ts
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { ProductClient } from "./client";
import type { ProductRef } from "./registry";

const env = readFileSync("C:/Users/gerod/RavenProjects/aira-admin/.env.nest.local", "utf8");
const leer = (k: string) =>
  env.split(/\r?\n/).find((l) => l.startsWith(k + "="))!.slice(k.length + 1).replace(/^"|"$/g, "").trim();

const ref: ProductRef = {
  slug: "nest", nombre: "Nest", baseUrl: leer("NEST_BASE_URL"), token: leer("NEST_ADMIN_API_TOKEN"),
};
const cli = () => new ProductClient(ref, { id: "prueba", email: "prueba@nest" });
const OUT = "C:/Users/gerod/AppData/Local/Temp/prueba-nest.txt";

describe("contrato real", () => {
  it("lee", async () => {
    const l: string[] = [];
    const m = await cli().manifest();
    l.push("manifest: " + (m.ok ? "OK" : JSON.stringify(m)));
    const e = await cli().equiposDe("10663452-fd04-401f-8e92-f5927f503703");
    l.push("equipos: " + (e.ok ? `OK, ${e.data.length}` : JSON.stringify(e)));
    // 409 esperado: ese equipo no tiene a quién transferirle.
    const t = await cli().transferirEquipo(
      "36642dae-024c-4bb5-be32-e7ddddfc5d00",
      "00000000-0000-0000-0000-000000000000",
      "prueba de contrato",
    );
    l.push("transferir(equipo vacio): " + JSON.stringify(t));
    writeFileSync(OUT, l.join("\n"));
  }, 60000);
});
```

```bash
npx vitest run src/core/products/__prueba.test.ts > /dev/null 2>&1; cat "C:/Users/gerod/AppData/Local/Temp/prueba-nest.txt"; rm -f src/core/products/__prueba.test.ts
```

Esperado: `manifest: OK`, `equipos: OK, 2`, y la transferencia devolviendo el 409 con el mensaje del producto entero. **Si `equipos` falla con "no respeta el contrato esperado", el schema de la Task 1 no coincide con lo que manda el producto** — comparar campo por campo antes de seguir.

- [ ] **Step 4: Probar en el navegador**

```bash
infisical export --env=dev > .env.local
cat .env.nest.local >> .env.local
npm run dev      # http://localhost:3100 — el 3000 lo usa AiraMed
```

Entrar a un usuario de Nest con equipos (`gerodc06@gmail.com`) y verificar: las dos tarjetas aparecen, "Ver equipos" trae los dos equipos con sus miembros y repos, el dueño no tiene botón de sacar, y el diálogo pide motivo. **No confirmar ninguna escritura contra producción sin avisarle a Gero.**

- [ ] **Step 5: Commit y PR**

La rama se llama `feat/nest-plan-y-equipos` y se crea al empezar la Task 1, no acá:

```bash
git add src/products/registro.ts
git commit -m "feat(admin): dibujar las secciones de plan y equipos de Nest"
git push -u origin feat/nest-plan-y-equipos
gh pr create --repo aira-org/aira-admin --base main \
  --title "Nest: cambiar plan y operar equipos desde el back-office" \
  --body "$(cat <<'CUERPO'
Suma a Nest las dos cosas que el contrato ya expone y el admin todavía no usaba:
cambiar el plan de una cuenta, y operar sus equipos (ver miembros y repos
compartidos, sacar a alguien o cancelar una invitación, y transferir la
propiedad).

**Del core se toca lo mínimo y todo aditivo:** los schemas zod de la respuesta de
equipos, cuatro métodos en `ProductClient` (mismo patrón bespoke que ya tienen
`vapi-config`, `grabaciones` y `republish`), y tres etiquetas en el mapa del
audit. `pedir()` suma `DELETE` a los métodos que acepta. **Ni una pantalla, ni el
RBAC:** todo entra en `acciones:ejecutar`, que ya existe.

Las dos pantallas son bespoke, en `src/products/nest/`, siguiendo el patrón de
`products/airamed/`: componente `"use client"` + `acciones.ts` propio +
`DialogMotivo` del core. Se registran por `manifest.sections[].module`, que es el
punto de extensión previsto.

**Dos cosas del modelo de Nest que la UI respeta a propósito:**

- La propiedad de un equipo la define `teams.owner_id`, **no** el rol: hay
  equipos con cuatro miembros marcados `leader` y un solo dueño. El rol se
  muestra como dato y nada más.
- Al dueño no se lo puede sacar (dejaría el equipo apuntando a alguien que ya no
  está en él) y al transferir, el dueño saliente **queda como miembro**: no se le
  quita el acceso a nadie ni cambia cuántos seats se facturan.

**Cambiar el plan no toca Stripe**, y la pantalla lo dice: escribe el plan y nada
más, igual que la herramienta que reemplaza.

El contrato del otro lado ya está deployado y verificado contra producción.

Probado con el `ProductClient` real contra la function real, no sólo con mocks.
CUERPO
)"
```

El PR va contra `main` de `aira-org/aira-admin`. **No mergearlo**: lo revisa Lucas.

⚠️ Su CI tiene un bloqueo conocido: un deploy cuyo commit no es de Lucas queda `BLOCKED` en Vercel sin decir nada (`vercel-blocks-collaborator-deploys`). Si el deploy del PR se cuelga en `Building…`, no es el código.

---

## Lo que este plan NO hace

- **No toca `raven-nest`.** El contrato ya está deployado y verificado.
- **No agrega permisos** ni toca `src/core/rbac/`.
- **No toca ninguna pantalla del core** — sólo el registro, que es el punto de extensión previsto.
- **No expone el borrado de usuarios**, que quedó fuera de alcance el 2026-09-02.
- **No agrega tests a `src/products/`**: ese directorio no tiene ninguno hoy y este plan no cambia esa decisión, que es de Lucas.
