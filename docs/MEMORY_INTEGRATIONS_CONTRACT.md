# Nest Memory + Integrations — contrato

> Para: Bauti (dueño de `feat/nest-memory-phase1`)
> De: Gero (dueño de `feat/integrations`)
> Fecha: 2026-08-26

## Por qué existe este doc

Leímos `feat/nest-memory-phase1` entera. Phase 1 está implementada y el diseño se sostiene
solo, así que **no vamos a tocar nada tuyo**. Lo que sigue es lo que Integrations quiere
construir encima, qué necesita de tu lado, y tres bugs de tu rama que solo se ven cuando
las dos ramas se juntan.

**Regla que nos autoimponemos**: cero modificaciones a `electron/memory-*.ts`, a
`supabase/migrations/20260730000000_nest_memory.sql` y a las edge functions. Todo lo
nuestro vive en `electron/integrations/` y en archivos nuevos. Escribimos únicamente por
`store.save()`, nunca un INSERT directo, para heredar tu redacción, tu dedupe, tu
`mutation_log` y tu sync.

---

## 1. Qué construye Integrations: tu Layer C

Tu §2.3 (PTY lifecycle capture, harness-agnostic) está diseñada pero sin implementar:
`'pty'` figura como valor de `ObservationSource` (`memory-protocol.ts:25`) y ninguna línea
lo escribe. Integrations es exactamente la máquina que la puede llenar.

`electron/integrations/bus-types.ts` ya emite eventos de dominio tipados:

| Evento | Qué sabe que un MCP no puede saber |
|---|---|
| `GraphNodeDone` | Qué rol terminó, con qué exit code, en qué worktree |
| `GraphGateBlocked` | Qué reviewers bloquearon y por qué |
| `ChangesRequested` | El feedback textual que un humano escribió al rechazar |
| `CiFailed` / `PrMerged` | Si el cambio efectivamente sobrevivió |
| `SessionOpened` / `SessionClosed` | El envelope de sesión de tu §2.3, tal cual |

Y `graph-verdict.ts` ya parsea `{concerns, blocking}` de cada reviewer. Eso es material de
`type:'discovery'` y `type:'bugfix'` con causa raíz, ya estructurado, que hoy se escribe en
`.nest/graph/review-*.json` dentro del worktree y **muere cuando el worktree se borra**.

La diferencia de fondo con Layer A: tu §10 R-1 marca "model non-compliance" como el riesgo
más alto del producto, porque `memory_save` depende de que el modelo se acuerde. Un evento
de bus no depende de nadie. Es determinístico como un hook, pero funciona con cualquier
CLI, incluidos los que todavía no existen.

---

## 2. El contrato: dos puertos

Usamos tu propio patrón. Vos no importaste memory dentro de `PtyManager`: definiste
`PtyMemoryIntegration` como interface inyectada y `main.ts` conecta los cables. Nosotros
hacemos lo mismo del otro lado, así Integrations compila y testea sin tu rama, sin
`better-sqlite3` y sin Electron.

```ts
// electron/integrations/memory-port.ts  (archivo nuestro, en nuestra rama)

/** Escritura. Lo satisface un adapter de 20 lineas sobre tu MemoryStore. */
export interface MemorySink {
  save(input: {
    cwd: string            // resolves vos el projectKey, igual que memory-ipc-server
    title: string
    content: string
    type: 'decision' | 'bugfix' | 'architecture' | 'discovery' | 'pattern' | 'config' | 'preference' | 'session'
    topicKey?: string
    tags?: string[]
    sourceRef: string      // idempotencia: 'graph:{runId}:{nodeId}'
    originAi?: string
    gitBranch?: string
  }): void
}

/** Lectura, para la graph view y el vault markdown. */
export interface MemoryReader {
  listForProject(projectKey: string, opts?: { includeSuperseded?: boolean }): ObservationSummary[]
}
```

Implementación por defecto: no-op. Cuando las ramas se junten, `main.ts` inyecta el adapter
real y todo se enciende.

**Tu `SaveInput` ya acepta todo lo que necesitamos.** No hay que agregarle un campo. En
particular `sourceRef` con el índice `UNIQUE (source, source_ref)` nos da idempotencia
gratis: un evento de graph re-emitido actualiza en vez de duplicar.

---

## 3. Lo que necesitamos de vos

Tres pedidos. **Ninguno bloquea lo que estamos haciendo ahora**, y todos se pueden resolver
del lado nuestro de forma más torcida si preferís no tocarlos.

**3.1 — Un método de lectura que incluya los superseded.** `context()`
(`memory-store.ts:676`) y `search()` (`:658`) filtran `superseded_by IS NULL`, que es
correcto para un agente. Pero para dibujar el grafo los superseded **son** las aristas: son
la única relación explícita entre dos memorias que existe hoy en el schema. Nos sirve
cualquier forma: un flag en `context()`, un método nuevo, o que nos digas que abramos un
handle `readonly: true` aparte y hagamos el query nosotros (WAL lo permite, y es lo que
haríamos por default para no tocarte nada).

**3.2 — Que el shim resuelva socket y token por archivo cuando no hay env.**
`memory-mcp/index.ts:23` y `:32` leen `NEST_MEMORY_SOCKET` y `NEST_MEMORY_TOKEN` del
entorno, que se los inyecta `pty-manager`. Fuera de un pane de Nest ese env no existe y el
shim se apaga solo. Pero `pipe-auth.json` ya vive en `~/.raven-nest/memory/` con mode 0600
y tiene el `pipeId` y el `token`, así que un fallback a leer ese archivo cuando el env falta
habilita usar la memoria desde Cursor o desde una terminal común, con Nest abierto en la
bandeja. Son diez líneas y no cambian el modelo de seguridad: el archivo ya es la fuente de
verdad y ya está protegido por permisos de usuario. Esto responde tu **O-7** en positivo:
Gero quiere que la memoria se use fuera de Nest.

**3.3 — Aristas como wikilinks en el `content`.** Vamos a escribir `[[sync-id]]` dentro del
texto de las memorias que el puente genere, para enlazarlas entre sí. Elegimos ese formato
en vez de una tabla porque replica gratis por tu sync, se exporta gratis a markdown, no
necesita schema, y es lo que Obsidian entiende nativo. Si te parece bien, tu importer de
markdown podría parsearlos también cuando lee `CLAUDE.md`.

---

## 4. Tres bugs tuyos que solo se ven al juntar las ramas

No los podés ver desde tu rama porque necesitan el orquestador de graph. El merge entre las
dos, ya probado con `git merge-tree`, da **un solo conflicto y es `.env.example`**.

**4.1 — `cmd === 'claude'` es comparación exacta.** `pty-manager.ts:185`. Los nodos del
graph se lanzan con `launchCommand()`, que devuelve `claude --model <x>` cuando el nodo
tiene modelo asignado. Ese caso no matchea, así que el nodo arranca **sin `--settings`**:
sin hooks de memoria, en silencio. Los nodos sin modelo sí funcionan, lo que lo hace peor
porque falla de a ratos. Fix: comparar contra `cmd.split(' ')[0]` e insertar el flag en vez
de reconstruir el comando entero.

**4.2 — `accountDir` vacío saltea el bloque completo.** `pty-manager.ts:133` envuelve toda
la inyección de memoria en `if (accountDir && cmd)`. En integrations,
`accountDirForAgent()` (`main.ts:2923`) devuelve `''` cuando el agente no tiene ninguna
cuenta guardada, y ese valor se pasa tal cual en `main.ts:2982`. Resultado: un nodo headless
corriendo con el HOME real queda afuera de memoria por completo, sin env y sin provisioning.

**4.3 — El coder del template `full` corre con codex, que no está provisionado.** Solo
`claude` recibe el shim MCP en Phase 1. El nodo que más decisiones toma en el pipeline por
defecto es justo el que no tiene memoria. No es un bug tuyo estrictamente: es tu Phase 2
llegando antes de lo previsto.

---

## 5. Decisiones de producto que caen de tu lado

Gero las definió esta semana. Las anotamos acá porque son tuyas para implementar, no
nuestras.

**5.1 — El Supabase de memoria debería estar separado del de producción.** Hoy las seis
tablas `memory_*` viven en el mismo proyecto que `profiles`, `teams` y Stripe. Tres razones
para separarlo, y conviene ahora que hay cero filas: en esa base ya está el pendiente del
`github_token` en texto plano, y un problema de RLS ahí pasaría de exponer un token a
exponer memoria; la memoria crece sin techo mientras el resto no, así que mezcladas no se
puede atribuir el costo; y separado se puede mover después sin tocar la autenticación.

**5.2 — El backend tiene que ser configurable por el usuario.** Hoy la URL sale de
`MAIN_VITE_SUPABASE_URL`, que es build-time. Gero quiere tres niveles: local sin sync (ya
está, es el default), sync contra el Supabase del propio usuario (no existe, y es barato
porque tus migraciones y edge functions ya son un artefacto portable), y Nest self-hosted
entero (otra conversación). El nivel del medio es exactamente lo que pide un cliente
enterprise, y ese tier ya existe.

**5.3 — El disparador de conversión no es multi-device, es el equipo.** Si el free local es
el producto completo menos replicación, nadie paga por "quiero memoria". Pagan por "quiero
que mi equipo la vea", y eso además es lo único que ninguno de los ocho competidores tiene.
Vale la pena que el peso del diseño de Teams refleje eso.

---

## 6. Preguntas tuyas que quedaron respondidas

- **O-3 (techo del free tier)**: el free local es **ilimitado**, no capado. Confirmado por
  Gero. Tu argumento de §7.1 ("Free keeps full local memory on purpose. It is the demo.")
  quedó adoptado tal cual.
- **O-7 (CLI standalone / uso fuera de la app)**: **sí**, se quiere. Ver 3.2. Por ahora la
  respuesta barata es el fallback a `pipe-auth.json` con Nest en la bandeja; un binario Go
  solo se justificaría si algún día hay que funcionar sin Nest instalado, y tu decisión de
  dejar el protocolo en JSON por líneas mantiene esa puerta abierta.
- **O-9 (caps de enterprise)**: sigue abierta, es de ventas.

---

## 7. Qué hacemos nosotros mientras tanto

En `feat/integrations`, sin tocar nada tuyo:

1. **El puente**: consumidor del event bus y de los verdicts del graph que escribe por
   `MemorySink`. Testeable sin tu rama.
2. **El vault markdown**: proyección de las memorias a una carpeta de `.md` con wikilinks,
   en una sola dirección por ahora (el store manda, los archivos son espejo). Es la prueba
   verificable de la promesa de portabilidad, y de paso le da graph view gratis a cualquiera
   que ya use Obsidian.
3. **La graph view propia**: condicional. Primero el vault, después medir si la gente lo abre
   con Obsidian, y recién ahí decidir cuánto invertir en vista propia. Lo que sí la
   justifica es que Obsidian ve texto pero no ve procedencia: qué IA lo escribió, en qué
   branch, de qué verdict salió, si está sincronizado, si está promovido al equipo.

Cualquier objeción a esto es más barata ahora que en dos semanas.
