# Cifrado obligatorio al conectar la nube — diseño

**Fecha:** 2026-11-02 · **Rama:** `feat/memories-settings` · **Estado:** para revisión de Gero

## Principio

**Nest es el medio, no el lector.** La nube guarda y reparte la memoria entre las máquinas de
una cuenta (y de un equipo), pero no puede leer de qué habla la gente con sus agentes. Ningún
texto escrito por el usuario o por su agente llega al servidor en claro: ni desde Nest ni
desde el plugin `@nestmux/memory` en otro IDE o ADE.

Consecuencia aceptada: si alguien pierde todas sus máquinas y el código de recuperación, su
memoria de la nube es irrecuperable. Se le explica al activar, no se esconde.

## Problema

Hoy el cifrado es opt-in. Al tocar **Connect** en Memory settings › Sync, `memory:connect`
(`electron/main.ts`) guarda la credencial, importa la memoria local y dispara
`onNetworkRegain()`, que hace un push **en el mismo click**, antes de que el usuario vea la
tarjeta de cifrado. El tick del daemon (`main.ts`, arranque) también puede pushear apenas
existe el token. Con la cuenta en `key_epoch = 0` ningún gate lo frena y el servidor lo acepta.
En la CLI ni siquiera hay forma de activar el cifrado: `login` contra una cuenta en época 0
imprime "This account does not use encryption".

Lo que ya existe y se reusa: `activateEncryption` / `adoptExistingKey` / `recoverWithCode`
(`electron/memory-keys-client.ts`), el gate `needs_key` del daemon, el Re-upload, la pantalla
del código de recuperación de `MemoryEncryptionCard`, y el rechazo `encryption_required` del
servidor (commit `276148b`, hoy sólo con `key_epoch > 0`).

## Decisiones (Gero, 2026-11-02)

1. Conectar la nube implica cifrar. El código de recuperación se muestra antes de subir nada.
2. Las cuentas que ya tienen memoria en claro en la nube **tienen que activar**: el sync se
   frena hasta que lo hagan, y al activar se re-sube todo sellado.
3. En la CLI, `login` activa el cifrado en el mismo paso.

## Diseño

### 1. Servidor: ninguna fila personal en claro

- `server/src/push.ts`: el rechazo `encryption_required` deja de depender de `key_epoch`. Toda
  fila con `scope !== 'team'` que no `viajaSellado` se rechaza. (Las de equipo siguen con
  `team_encryption_required` cuando el equipo cifra; un equipo que no cifra queda fuera de este
  spec, ver "Fuera de alcance".)
- `viajaSellado` suma `git_branch` a los campos que tienen que venir sellados.
- `GET /v1/sync/status` suma `plaintext_pending`: cuántas observaciones propias, no borradas y
  `scope !== 'team'`, tienen algún campo sellable en claro. Es lo que le dice al cliente si la
  migración terminó.
- Un Re-upload con el mismo `sync_id` ya pisa la fila en claro con la sellada; no hace falta
  borrar nada en el servidor.

### 2. Cliente: el gate exige la maestra siempre

- `MemoryDaemonDeps.requireEncryption?: () => boolean`. La app (`main.ts`) y el paquete
  (`daemon-del-paquete.ts`) la pasan devolviendo `true`.
- En `doPush`, con `requireEncryption()` y sin maestra vigente:
  - época conocida 0 → estado `error` con detalle `needs_encryption_setup`, no sale nada;
  - época > 0 → `needs_key`, como hoy.
- El gate corre en todo push (intervalo, foco, debounce de escritura, drain), así que tapa
  también el tick que hoy puede adelantarse al connect.
- `sealMutationPayload` suma `git_branch` a `SEALED_FIELDS`, y `openPulledRow` lo abre.
- El rechazo `encryption_required` sigue sin descartar la fila (comportamiento de `276148b`).

### 3. Conectar en Nest: conectar y asegurar en un solo paso

`memory:connect` (y `connectWithLogin` / `connectWithToken` de `useMemory`) pasa a:

1. Guardar la credencial (como hoy).
2. **Asegurar la cuenta** en el main, nuevo `asegurarCifrado()`:
   - `adoptExistingKey()` → si adopta, listo.
   - Si no adopta, leer el estado remoto. Época 0 **leída de verdad** → `activateEncryption()`
     y devolver `recoveryCode`. Época > 0 sin envoltura para esta máquina → estado
     `esperando-autorizacion` con la huella propia (la clave pública ya quedó enrolada, así la
     otra máquina la ve pendiente enseguida). Estado ilegible (sin red, 5xx) → no se activa a
     ciegas; queda `needs_encryption_setup` y se reintenta con el botón.
   - Un `409 stale_key_epoch` de `activateEncryption` (otra máquina activó en el medio) →
     adoptar.
3. El código de recuperación queda guardado **en el main** (en memoria del proceso, nunca en
   disco ni en logs) hasta que el renderer confirme "lo guardé"; así cambiar de pestaña no lo
   pierde. Recién con esa confirmación se importa la memoria local y corre el primer drain.
4. `CloudMemoryCard` muestra, según el resultado: el código (reusa el bloque de
   `MemoryEncryptionCard`, con el checkbox "I have saved it somewhere safe" como condición), la
   espera de autorización con la huella, o el botón **Turn on encryption** para reintentar.

La segunda máquina nunca llama a `activateEncryption` contra una cuenta que ya cifra: el orden
"adoptar primero" y el 409 lo garantizan.

### 4. Cuentas que ya están en claro

- Al abrir la versión nueva, una cuenta conectada en época 0 cae en `needs_encryption_setup`
  (el gate del punto 2). `CloudMemoryCard` muestra "Your cloud memory isn't encrypted yet" con
  **Turn on encryption**, que corre `asegurarCifrado()` y el mismo flujo del código.
- Al activar se dispara solo el Re-upload (hoy botón manual en `MemoryEncryptionCard`).
- La tarjeta dice "Encrypted" sólo con `plaintext_pending === 0`. Mientras tanto,
  "Encrypting your cloud memory… N left", y el Re-upload se reintenta en cada status hasta
  llegar a 0 (mismo patrón que la migración de equipo).

### 5. CLI (`npx @nestmux/memory`)

- `login`, después de guardar la credencial, corre el mismo `asegurarCifrado()` (vía
  `enrolamiento-del-paquete.ts`):
  - época 0 → activa, imprime el código de recuperación con el aviso de pérdida y pide escribir
    `saved` para seguir; sin eso no guarda la maestra como "confirmada" y el sync no arranca;
  - época > 0 → imprime la huella y "Approve this machine from another device, or run
    `nestmux-memory recover`".
- `status` muestra `needs_encryption_setup`, la espera de autorización y `plaintext_pending`.
- Hoy `login` necesita que el código se apruebe desde un Nest abierto. Que funcione sin Nest es
  otro spec (Fase 1, punto 4); este diseño no depende de cómo se apruebe el login.

### 6. Textos (en inglés, como toda la UI)

- `needs_encryption_setup`: "Cloud sync is paused until encryption is on. Only you hold the key
  — we can't read your memory."
- Código: "Save this recovery code. It's the only way back in if you lose every machine. We
  can't recover it for you."

## Qué ve el servidor después de esto

| Campo | Estado |
|---|---|
| `title`, `content`, `tags`, `project_display_name`, `content_hash`, `origin_account`, `git_branch` | Sellados (`nmc1:`) |
| `topic_key` | HMAC con la clave de la cuenta / del equipo |
| `project_key` | sha256 **sin sal** de la URL del remoto o de la ruta — ver pendiente |
| `sync_id`, `scope`, `type`, `lamport`, fechas, `deleted`, `superseded_by`, `origin_ai`, `author_display` | En claro: los necesita para ordenar, mezclar y repartir |

**Pendiente (otro spec):** `project_key` sin sal permite adivinar en qué repo **público** trabaja
alguien (hashear `github.com/org/repo` y comparar). Pasarlo a HMAC por cuenta rompe hoy el
cruce de proyectos entre miembros de un equipo, así que necesita su propio diseño.

## Errores y bordes

- Activar falla después de generar la maestra (safeStorage no abre): se mantiene el patrón
  `aviso` actual; el código se muestra igual y el sync queda bloqueado hasta que la maestra
  quede guardada.
- El usuario cierra la app con el código sin confirmar: la maestra ya está publicada y
  guardada; al volver, la tarjeta ofrece "Show recovery code again" sólo si el main todavía lo
  tiene en memoria; si no, ofrece **generar un código nuevo**. Eso hoy NO existe: el servidor
  rechaza a propósito pisar el slot `recovery` desde `authorize` (`cannot_overwrite_recovery`,
  `server/src/keys.ts`). Se agrega un modo `recovery` a la publicación de envolturas: exige
  `rotate_proof` (probar la maestra, como toda publicación para otra máquina), `key_epoch`
  igual al actual, y toca **sólo** el slot `recovery`. Del lado cliente,
  `regenerateRecoveryCode()` en `memory-keys-client.ts`. El código viejo deja de servir.
- Dos máquinas conectan a la vez una cuenta nueva: una gana con `activate`, la otra recibe 409 y
  adopta (ya cubierto en el servidor por `stale_key_epoch`).
- Cliente viejo (sin este cambio) contra el servidor nuevo: sus filas en claro reciben
  `encryption_required`; las versiones con `276148b` no las descartan, las anteriores las marcan
  como rechazadas. No hay pérdida local: la base local sigue teniendo todo.

## Tests

- Servidor: `push-personal-encryption.test.ts` pasa a cubrir época 0 (rechazo) y `git_branch`
  en claro; `status` devuelve `plaintext_pending` correcto antes y después de un re-upload.
- Daemon: con `requireEncryption` y sin maestra no sale nada, tampoco por el tick del intervalo;
  estado `needs_encryption_setup` en época 0 y `needs_key` en época > 0.
- **El test que importa:** conectar una cuenta nueva de punta a punta (main + daemon con fetch
  simulado) y verificar que el servidor simulado **nunca** recibe una fila personal con un
  campo sellable en claro.
- Servidor: modo `recovery` — sin `rotate_proof` válido 403, con época distinta 409, nunca
  toca slots de device; el código viejo deja de abrir y el nuevo abre.
- `useMemory`: conectar → activar → mostrar código; conectar → adoptar; conectar sin red → no
  activa.
- `CloudMemoryCard`: los tres estados y el checkbox como condición.
- `enrolamiento-del-paquete` / `login-del-paquete`: época 0 activa y pide `saved`; época > 0
  espera.
- e2e `12-cifrado-dos-maquinas.spec.ts`: conectar A ya cifra; B conecta y espera; A autoriza.
  Correr headless contra `dist/` (`npm run build` antes).

## Fuera de alcance

- Login y compra sin Nest (Fase 1, punto 4).
- Cifrado obligatorio para equipos que hoy no cifran (Teams sale después del lanzamiento).
- Rotar la clave de equipo al sacar a un miembro.
- `project_key` con sal / HMAC.
