# Contrato `admin-api` — lo que falta, y es tuyo

> Las tareas 1 a 7 del plan están hechas, revisadas y commiteadas en `feat/nest-admin-api`.
> Quedan las tres que salen del worktree. Este documento es lo que necesitás para correrlas.

**Estado:** 15 commits sobre `main`. Suite **787 passed | 1 skipped** (base de la rama: 698).
Ningún test rojo propio — el "Test Files: 1 failed" que muestra `npm test` en el worktree es
`worktrees-tutorial-button.test.tsx`, que no carga porque el worktree no tiene `.env.local`.
Verificado: ambiental y preexistente.

---

## El orden importa, y no es negociable

### 1. La migración va PRIMERO

```sql
-- supabase/migrations/20260828000000_admin_audit_actor.sql
```

Aplicala **desde el SQL editor del dashboard**. Si la función se deploya antes, `PUT /plan` y
`DELETE` van a funcionar y responder `auditado: false` — no mienten, pero no auditan.

> ⚠️ **NUNCA `npx supabase db push`.** Con el `config.toml` nuevo el repo pasó a ser un
> proyecto CLI, y `supabase/migrations/` tiene 30+ archivos que se aplicaron a mano y no están
> registrados en `schema_migrations`. `db push` los listaría e intentaría re-crear políticas RLS
> sobre producción.

Verificá después: las 5 columnas nuevas (`actor`, `actor_email`, `motivo`, `ok`, `error`).

### 2. El secret

Mínimo 32 caracteres reales. Con uno más corto el guard rechaza **todo** con 401 y parece un
problema de `verify_jwt`.

```bash
NEST_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
npx supabase secrets set NEST_ADMIN_API_TOKEN="$NEST_TOKEN" --project-ref qkqlsytxtshgjxwmafpw
```

### 3. El deploy — SIEMPRE por nombre

```bash
npx supabase functions deploy admin-api --project-ref qkqlsytxtshgjxwmafpw
```

Nunca sin nombre. El `config.toml` ahora declara las 7 funciones, pero un deploy sin nombre
las sube todas desde las fuentes locales, y eso incluye funciones que nadie revisó en esta rama.

---

## Decisión pendiente tuya: el webhook de Stripe

`.github/workflows/release.yml:359` deploya `stripe-webhook` **sin** `--no-verify-jwt`, mientras
las otras cuatro (líneas 358, 360, 361, 362) sí lo llevan. Esa es la causa del bug que tenés
abierto: el webhook rechaza todo con 401 y ningún checkout activa un plan.

Con el `config.toml` que agrega esta rama, **el próximo release probablemente lo arregle solo**:
las versiones actuales del CLI sólo dejan que `--no-verify-jwt` pise al config cuando se lo pasa
explícitamente, así que ese deploy tomaría el `verify_jwt = false` nuevo.

**"Probablemente" no es "seguro":** depende de la versión del CLI que resuelva `setup-cli@v1` con
`version: latest`. Si querés que no dependa de eso, agregá `--no-verify-jwt` a la línea 359.

No lo toqué: es el pipeline de publicación de la app y tu `CLAUDE.md` tiene advertencias
explícitas sobre esos workflows. Es tu llamada.

**Y si se arregla, es un cambio de comportamiento:** Stripe entrega en lote los webhooks que
viene reintentando, y se activan planes de golpe. Mejor que sea una decisión y no una sorpresa.

---

## Qué mirar en el smoke (Task 8)

Además de los pasos del plan, tres cosas que no se pudieron verificar desde el repo:

1. **`last_activity_at` viene con fecha y no `null` para todos.** Si viene todo `null`, el log
   dice `[admin-api] no se pudo leer user_last_activity` y el problema es el nombre de la vista
   o de su columna `user_id`. La vista existe en producción; lo no confirmado es el nombre de esa
   clave.
2. **Un `DELETE` real no devuelve `auditado: false`.** Ya verifiqué que `admin_audit_log` no tiene
   FK a `auth.users`, así que debería poder escribirse después de borrar — pero conviene verlo.
3. **`accounts.length === 82`**, no sólo que responda. La respuesta trae `truncado: true` si
   GoTrue devolvió menos de los que hay.

Si el deploy falla resolviendo `vitest`, es porque `__tests__/` vive dentro del directorio
deployable: mové los tests fuera de `supabase/functions/`.

Y si el smoke devuelve `404 {"error":"No encontrado"}` en vez de 401, no es el guard: es el
prefijo del path. `router.ts` pela `^/admin-api`; un path con `/functions/v1/` adelante (típico de
`supabase functions serve` local) no matchea.

---

## Cambios de forma del contrato, para el PR al repo de Lucas (Task 9)

- `GET /accounts` devuelve `{ accounts, truncado }` — no un array pelado.
- `DELETE` devuelve `tenia_stripe`: la cuenta se borró pero **su suscripción de Stripe sigue
  viva**. Cancelarla es manual y el contrato es el único lugar que sabe que existía.
- Las dos escrituras pueden traer `auditado: false`.
- `DELETE`/`POST` sobre `/accounts` y `/manifest` responden `405`.
- El `500` del catch general dice `"Error interno"`; el detalle queda en los logs de la función.

Verificado: el zod del core de `aira-admin` acepta `"suspendido"` en `estadoSaludSchema`, así que
la ficha de una cuenta morosa parsea bien.

---

## Deuda anotada, nada bloqueante

- Una cuenta `free` con una suscripción cancelada —el final normal de un churn— sale
  `health: suspendido`. Es cierto pero es ruido en el campo que existe para alarmar. Un
  `plan !== 'free' &&` en `mapear.ts` lo acota. Es decisión de producto.
- La regla de desempate de suscripciones está escrita dos veces: `elegirSub` en `pricing.ts`
  (testeada) y su equivalente inline en `index.ts` (no testeable). Hoy son idénticas; la próxima
  edición de una no viaja a la otra.
- Con Stripe caído la ficha omite el meter `seats` pero el manifest lo sigue declarando. Un
  renderer que itere `manifest.usage_meters` y haga `.used` sin guard rompería sólo en ese camino.
  Probarlo una vez en la Task 9.
- `admin-api` y `gitlab-oauth` no están en `release.yml`: se deployan a mano y pueden quedar
  desfasadas del repo sin que nada avise.
- `index.ts` no tiene tests y no puede tenerlos. Todo lo testeable se empujó a módulos puros;
  lo que queda está verificado por lectura en tres revisiones.
