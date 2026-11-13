# Nest Memory — entornos de prueba

Cómo probar el subsistema de memoria de punta a punta **antes** de que exista el backend de
sync real. Todo lo de acá corre local y no toca ni tu Nest ni producción.

Relacionados: la spec `docs/superpowers/specs/2026-08-31-memory-sync-backend-design.md` (§5
el contrato de wire, §13 el plan de testeo) y el plan de cliente
`docs/superpowers/plans/2026-09-01-memory-client-c1-c8.md`.

## Las tres capas, de la más barata a la más cara

| Capa | Qué valida | Cuánto tarda | Necesita el servidor real |
|---|---|---|---|
| Tests unitarios | El cliente aislado: store, daemon, merge, card | ~3 s | no |
| **Contract check** | Que el servicio del otro lado no pierda datos | ~2 s | no, corre contra el stub |
| **Round trip de 2 devices** | Que dos máquinas converjan de verdad | minutos, a mano | no, corre contra el stub |
| Carga y concurrencia | `project_seq` con conexiones peleando | — | **sí** |

Las dos del medio son las que este repo no tenía y son las que valían la pena.

---

## 1. Tests unitarios

```bash
npm run native:node                                  # el binding de Node, para vitest
npx vitest run electron/__tests__/memory-*.test.ts   # 198 tests
npm run native:electron                              # devolver el binding de Electron
```

Ese swap es obligatorio: `better-sqlite3` necesita un binario por ABI y los dos van al
mismo path. Está explicado en `CLAUDE.md`. `npm test` dispara `pretest` y hace el primer
paso solo; el de vuelta es a mano.

---

## 2. El servicio stub y el contract check

El backend real es otro plan y todavía no existe. Sin algo del otro lado del socket, los
cambios de cliente sólo se pueden testear unitariamente, y justamente lo que se construyó
—dos máquinas convergiendo— no se puede ejercitar. El stub cierra ese hueco.

```bash
node scripts/memory-sync-stub.mjs --port 8787 --token nmk_test_token
```

En otra terminal:

```bash
node scripts/memory-sync-contract-check.mjs --base http://127.0.0.1:8787 --token nmk_test_token
```

Salida esperada: **19 propiedades en OK y exit 0.** Cada una es un bug real que el backend
viejo tenía:

1. **Colisión de topic** — el perdedor se supersede, no se rechaza (§8.1). El servidor viejo
   hacía un INSERT plano contra un índice único, la segunda memoria volvía `rejected`, el
   cliente la marcaba pushed y no la reintentaba nunca. Las dos máquinas quedaban mostrando
   memorias distintas para el mismo topic, para siempre.
2. **Tombstones** — el borrado cruza (§8.2). El servidor viejo nunca leía `op` y su columna
   `content` era NOT NULL, así que borrar en una máquina no llegaba nunca a la otra.
3. **Idempotencia** por `(device_id, seq)` (§5.1). Una respuesta perdida en la red es
   indistinguible de una mutación no procesada.
4. **Tags** sobreviven como array de verdad (§5.2). Se perdían en cada round trip, en las
   dos direcciones, sin un solo error.
5. **`client_updated_at`** es el reloj del cliente (§5.2). Si el servidor pone el suyo, todo
   LWW se computa contra el valor equivocado y la convergencia deja de ser determinista.
6. **`project_seq`** monótono y sin agujeros (§7). El cursor es `project_seq > n`: un agujero
   es una fila que nadie pulea nunca.
7. **El pull incremental vuelve vacío**, que es el 99% del tráfico real.

**El mismo checker sirve para el servidor real.** No sabe contra qué habla: sólo el
contrato §5. Cuando el servicio exista, apuntalo ahí y tiene que dar lo mismo.

### Qué es el stub y qué no

Es dos handlers HTTP y un Map en memoria. **No** tiene tenancy, cuotas, rate limits ni
durabilidad, y no debe correr en ningún lado público. Sí implementa en serio las partes
donde el cliente puede equivocarse: los outcomes por mutación, la idempotencia, la
resolución de colisión, los tombstones, la asignación de `project_seq` por rango, y las
rutas viejas de Supabase como alias (§5.4) para poder apuntarle un Nest que todavía no
tenga el cambio de rutas.

Con `--state ./stub-state.json` persiste entre arranques. Sin eso, arranca limpio.

---

## 3. Round trip de dos devices

Es el test de §13 que importa: **dos instancias de Nest con `~/.raven-nest` distintos contra
el mismo servicio.** Y adentro, el caso que la spec dice que hoy rompe: dos devices
escribiendo el mismo `topic_key` offline. Es lo primero que va a pasar entre tu PC y tu Mac.

Dos cosas hay que separar, y se separan con **dos palancas distintas**:

- **`RAVEN_HOME`** redirige `.raven-nest`, o sea `memory.db`, `connection.json` y
  `credential.bin` (`electron/raven-home.ts:33`). `userHome()` lo ignora a propósito, así que
  las terminales siguen abriendo en tu home real.
- **`--user-data-dir`** redirige el `userData` de Electron, que es a lo que está keyeado el
  single-instance lock (`electron/main.ts:81`, incondicional). Sin esto la segunda instancia
  hace `app.quit()` y muere con exit 0 y sin ventana: parece un crash y no lo es. Setear
  `APPDATA` **no** alcanza; sólo funciona el switch.

El switch necesita **doble `--`**: el primero es de npm, el segundo es el passthrough de
electron-vite. Con uno solo, el parser de electron-vite rechaza el flag y aborta.

El script ya hace todo eso:

```powershell
# terminal 1: el servicio
node scripts/memory-sync-stub.mjs --port 8787 --token nmk_test_token

# terminal 2: device A
.\scripts\memory-smoke-device.ps1 -Device a

# terminal 3: device B
.\scripts\memory-smoke-device.ps1 -Device b
```

Los homes van a `%LOCALAPPDATA%\nest-memory-smoke\`, **fuera** de `~/.raven-nest` a
propósito: esa carpeta es un junction a OneDrive y las bases de prueba se sincronizarían a
la Mac.

En cada instancia: **Settings → Account → pegar `nmk_test_token` → Connect.** El token no se
puede sembrar desde el script porque vive en `credential.bin` encriptado con `safeStorage`,
que sólo la app puede escribir. Igual conviene pasar por ahí: ese es el flujo que se
construyó y ejercitarlo es parte del punto.

### Qué mirar

1. Escribir una memoria en A (por MCP desde un pane de Claude, o por el board del graph).
2. Esperar el push, o forzarlo. En la consola del stub se ve `push 1 mutations -> 1 applied`.
3. En B, confirmar que aparece.
4. **El caso que rompe:** desconectar los dos, escribir el mismo `topic_key` en A y en B con
   contenidos distintos, reconectar. Los dos tienen que terminar mostrando **el mismo
   ganador**, y el perdedor tiene que seguir existiendo supersedido, no desaparecido.
5. Borrar en A y confirmar que el borrado llega a B.

---

## 4. Lo que todavía no se puede probar acá

- **Concurrencia real sobre `project_seq`.** El benchmark de la spec corrió en PGlite, que es
  de una sola conexión, y el stub es Node single-threaded: los dos hacen que la asignación
  por rango parezca trivialmente correcta. **Con Postgres y N clientes peleando hay que
  verificar que no se produzca ni un hueco ni un duplicado**, y eso es obligatorio antes de
  abrir a usuarios (spec §13).
- **Backups y restore.** Un backup que nunca se restauró no es un backup (spec §11.3).
- **Cuotas, rate limits y observabilidad de rechazos** (spec §11.5, §11.6).
- **El borrado de datos de nube.** `memory:disconnect` todavía postea a
  `/functions/v1/memory-sync/delete-cloud-data`, que es la única ruta con forma de Supabase
  que queda en el cliente. La spec §5 define push, pull y status, y **nunca definió el
  endpoint de borrado**, así que no hay a dónde migrarla todavía. El servicio nuevo tiene que
  seguir sirviendo ese alias, o el borrado se rompe en silencio cuando `syncBaseUrl` apunte
  afuera de Supabase.

## 5. Limpiar

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\nest-memory-smoke"
```

No corras `git clean` en el worktree para limpiar: `tsc -b` emite `.js`/`.d.ts` al lado de
los sources y `git clean` no distingue eso de un archivo nuevo sin trackear.
