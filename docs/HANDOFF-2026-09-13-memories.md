# Handoff — Memories, 13 de septiembre de 2026

Dónde retomar Memories. El día se fue a lo visual de los panes y las terminales; esto es lo
que quedó abierto **del lado de la memoria**, que es por donde seguir.

---

## Lo primero, porque no es desarrollo

Tres cosas bloquean que la memoria viaje entre máquinas, y ninguna se arregla escribiendo
código:

| | Qué falta |
|---|---|
| **El servicio corre código viejo** | `/v1/devices` da 404. Es un redespliegue desde `main` con `SUPABASE_JWT_SECRET` en el entorno. Es lo único que separa a las 120 memorias de sincronizar de verdad |
| **La app apunta al servicio viejo** | Hay que apuntarla al nuevo y dar de alta la cuenta en `allowlist` con un plan |
| **Los respaldos no están configurados** | El código está y se verificó restaurando uno; le faltan las cuatro variables `R2_*`. Hasta entonces la nube no tiene respaldo |

Y una que sí es trabajo, pero de una tarde con las dos máquinas encima del escritorio:

**El cifrado nunca se probó entre dos máquinas reales.** Está verificado de punta a punta
contra un servicio real, pero con dos máquinas *simuladas*. Activar en una, autorizar la otra
comparando la huella, y quemar un código de recuperación de verdad es un paso que no se puede
saltear antes de cobrarle a alguien.

---

## Lo que se cerró hoy

### La tercera revisión adversarial

64 agentes, 28 hallazgos crudos, 3 causas confirmadas. Las tres arregladas y **verificadas
con sondas propias antes de tocar nada**:

- **CRÍTICO — el gate fail-closed no se armaba nunca.** `isEncryptionExpected()` lee
  `knownKeyEpoch() > 0`, y esa época sólo la escribían los handlers de la tarjeta de cifrado
  (o sea, sólo si el usuario abría el overlay Memories) y `applyPulledRow` al bajar ciphertext.
  Ninguno corre en la máquina que importa: la que no tiene la clave. Y no era una carrera —
  activar el cifrado no re-cifra lo ya subido, así que una cuenta que venía sincronizando en
  claro deja al servidor lleno de filas legibles, la segunda máquina nunca baja nada que no
  pueda abrir, y la época se queda en 0 **para siempre**.
  **Arreglo**: `/v1/sync/status` devuelve `key_epoch` y `doStatus` lo persiste antes del pull
  y del push. Más: `push()` pide un status antes del primero de la sesión, porque
  `scheduleMutationPush()` y `onQuit()` lo llaman sin pasar por el drain.

- **ALTO — cualquier device de la cuenta pisaba la envoltura de otro.** La prueba de posesión
  se exigía sólo para el slot propio, o sea que tapaba el caso que no sirve para atacar.
  Sellar no requiere ningún secreto y `GET /v1/keys` reparte la pública de la víctima, así
  que un device nunca autorizado envolvía SU maestra para la víctima, que la adoptaba sin
  aviso. Ahora la prueba se exige para todo `authorize`.

- **MEDIO — `publishWraps` sin tope ni rate limit.** 20.000 wraps en un request, 10 segundos
  con el lock de la cuenta tomado, y `key_wraps` no cuenta contra la cuota. Tope de 64,
  validación de que el slot exista, y limitador propio para `/v1/keys*`.

### El contexto, que es lo que de verdad se paga

`memory_context` devolvía diez memorias con el **cuerpo entero** en cada arranque de sesión, y
su descripción le decía al modelo que era *"cheap"*. Medido sobre el corpus real de 120:

```
antes   21 162 bytes  ≈ 5 291 tokens   en CADA arranque
ahora    4 567 bytes  ≈ 1 142 tokens
```

Tres escalones: `SessionStart` (5 títulos, gratis) → `memory_context` (el índice, para decidir
cuál importa) → `memory_get` (el texto entero, sólo de las que eligió).

### El reloj de Lamport, a la base (esquema 8)

Se cargaba una vez al abrir y se incrementaba en memoria. Con dos procesos sobre la misma base
—la app instalada y un build de desarrollo, que ya pasa— los dos arrancan del mismo número y
emiten lamports **duplicados**. Reproducido con un proceso hijo real. Ahora sale de la base,
con índice (medido: 278µs sin índice contra 1µs con él), todas las transacciones de escritura
en `IMMEDIATE`, y `busy_timeout`.

Es el **paso 1 de la spec del paquete portable**, y va primero por eso.

### Otros

- La pantalla: grafo arriba, buscador abajo resaltando, aristas por tags encendidas, y el
  nodo aparece solo cuando un agente escribe.
- El vault: carpeta huérfana al renombrar un proyecto, y las memorias de equipo a `_team/`.
- `ensureProject` deja de ser insert-only: el nombre del repo ya no se congela en el hash.
- Planes: compartir memoria sale del autoservicio (lo compartido no se cifra). `handleShareProject`
  no chequeaba el plan — se compartía con éxito y después nada llegaba a nadie.

---

## Por dónde seguir

1. **Los tres bloqueantes de arriba.** Sin eso, nada de lo demás se puede probar de verdad.
2. **El paquete portable** — spec en `docs/superpowers/specs/2026-09-13-nest-memory-portable-design.md`.
   El paso 1 (Lamport) está hecho. Siguen: el candado de sincronización, el adaptador de
   `node:sqlite`, el paquete en modo local, el `setup`, la nube, y la extensión.
3. **El cursor de resume de engram.** No lo hice a propósito: no hay ninguna `engram.db` en
   esta máquina, el importador ya es idempotente, y optimizar a ciegas no sirve. Si aparece
   una base, se hace con una medición al lado.

---

## Lo que NO está verificado, dicho aparte

**Los arreglos de hoy no pasaron por una cuarta revisión.** Las tres rondas anteriores
encontraron problemas en la ronda anterior, sin excepción: la primera encontró 28, la segunda
encontró que 11 de esos 26 arreglos rompían algo, y la tercera encontró que el arreglo más
importante de las dos no llegaba a activarse. No hay motivo para creer que ésta fue la
primera limpia.

---

## Dos trampas del entorno que costaron tiempo

- **`pkill -f "electron dist-electron/main.js"` no matchea nada.** La línea de comando real
  tiene `Electron` con mayúscula y `pkill` distingue mayúsculas, así que el comando sale con
  éxito sin matar nada — y el lock de instancia única hace que el relanzamiento tampoco
  arranque un proceso nuevo. **Falla silenciosa por los dos lados.** Matar por PID y verificar
  que el `etime` del proceso nuevo sea de segundos.
- **`npm test` arregla el binding de `better-sqlite3`, `npx vitest run` no.** Después de
  `npm run native:electron` (para levantar la app), el suite entero se cae con 245 errores de
  ABI que no tienen nada que ver con el código. Correr `npm run native:node` antes.
