# Handoff — Memories en la app y el paquete portátil (2 de octubre de 2026, tarde)

Para seguir desde cualquier máquina. Rama: **`feat/nest-terminal-ui`**, todo commiteado y
pusheado (`405c34d`). **Sin release**: no se tocó `package.json`.

```bash
git fetch origin && git checkout feat/nest-terminal-ui && git pull
npm install            # deja el binding de Electron
```

Sigue al handoff de la mañana, `docs/HANDOFF-2026-10-02-memories-grafo.md`.

---

## Lo que se cerró

| commit | qué |
|---|---|
| `111bbba` | **Links estilo Obsidian en la app.** El documento se lee como Markdown (`MemoryMarkdown.tsx`, parser propio a React, nunca HTML crudo); `[[...]]` navega a esa memoria; los huecos se ven punteados y no navegan; «Mentioned in» al pie. Decisión de Gero: **sólo `[[...]]` linkea, la negrita no.** De paso: el backlink de un link resuelto por el último tramo del topic no aparecía (pegaba también en `memory_get`). |
| `9641d82` | La suite corre en verde en Windows. Las 8 fallas eran de los tests (separadores de path, bits de modo, `npx tsx` que no es dependencia), no del producto. El test de dos procesos además nunca probaba nada: le faltaba registrar el abridor de la base. |
| `ee61505` | El llavero de Windows (DPAPI) corre contra el sistema real. Estaba escrito y nunca ejecutado. |
| `df2a482` | En Windows `setup` escribe `cmd /c npx …`: Claude Code no lanza `npx` sin eso y Codex daba «program not found». |
| `0d9634d` | **El MCP del paquete escribe sin Nest.** Era de sólo lectura y no creaba su base: en una máquina nueva no servía. Corre el despacho del daemon en proceso (`MemoryIpcServer.responder`). |
| `b0095ce` | **El MCP del paquete sincroniza** (§6.2): pull al abrir, push tras cada escritura, suelta el candado entre operaciones, y **sólo sobre su base propia** (la de Nest puede ser de otra cuenta). |
| `aefd509` | `login` enrola la máquina y muestra la huella (§7). **Escrito por Codex (gpt-6-astra)**, verificado y commiteado por Claude. |
| `010f7c8` | **Con Nest abierto, el paquete le delega todo.** Lo encuentra por el `pipe-auth.json` (no sólo por las variables, que un editor externo nunca tiene) y confirma con `ping`. Busca bajo `ravenHome()`, no `homedir()`. |
| `6b541d6` | `status` decía que lo encolado subía «la próxima vez» cuando el cifrado lo tenía frenado. |
| `405c34d` | El servidor guarda `platform` de los dispositivos que entran por código. **No llega a Railway hasta que se deploye el servicio.** |

Verificado al cerrar: unitarios **3555** en verde (0 fallas en Windows), typecheck de CI
0/0, servidor 324/324, e2e `04`, `08` y el nuevo `11` en verde.

### La prueba de punta a punta del login

Contra el servicio corriendo en local (Postgres en Docker, JWT HS256 firmado a mano), porque
el login de la app de dev no entra: login con código → sync en claro → la cuenta activa el
cifrado → `login` publica la clave y muestra la huella → un secreto queda retenido sin subir
→ autorizada desde «otra máquina» → el siguiente push sube todo con `nmc1:`. **Cero filas en
claro.** La receta para repetirla está en la memoria `nest-memory-sync-service`.

---

## Por dónde seguir

- **Deploy del servicio** a Railway para que entre `405c34d` (plataforma de los dispositivos).
- **Reservar `nest-memory` en npm** (decisión de Gero, es publicar). Las configs que escribe
  `setup` ejecutan `npx -y nest-memory` y hoy el nombre está libre: si lo registra otro, se
  ejecuta su código.
- **El login contra Railway de verdad**, con Gero aprobando desde un Nest que tenga la tarjeta.
- Menor: la extensión de VS Code pinta su panel con `nestVivo: null` (para contar memorias da igual).

---

## Trampas que mordieron hoy

- **El servicio vivo es `https://sync-production-54ba.up.railway.app`.** `75a4` es un deploy
  viejo sin `/v1/link/*` (404). Y un build de dev con `MAIN_VITE_SUPABASE_URL` en el `.env`
  le habla a Supabase, no a Railway (orden: guardada → build → default); se cambia en
  Memories → «Sync service».
- **La Nest instalada en la PC Windows es la v1.5.0**: no tiene daemon de memoria. Para probar
  contra uno real, el build de la rama (el e2e 11 lo levanta aislado con `RAVEN_HOME`).
- **Binding nativo**: después de `npm test` la app no arranca hasta `npm run native:electron`;
  después de levantar la app o un e2e, los unitarios fallan en masa (313 de golpe) hasta
  `npm run native:node`. Mirar el hash antes de diagnosticar otra cosa.
- **Los e2e de memorias necesitan la CLI `sqlite3`** (el seeder). En Windows: `winget install
  SQLite.SQLite`; queda en `…\WinGet\Packages\SQLite.SQLite_…`, que puede no estar en el PATH.
- **Codex** (`CODEX_HOME=C:\Users\gerod\.codex codex exec -s workspace-write -C <worktree>`)
  escribe código pero su sandbox no corre vitest ni git en worktrees bajo `C:\Users\gerod\Dev`
  (EPERM): verificar y commitear desde Claude. Un junction de `node_modules` se borra con
  `cmd /c rmdir`, **nunca** con `Remove-Item` (se cuelga pidiendo confirmación).
- **`TaskStop` no mata el hijo de `tsx`**: cerrar el `node` que quede escuchando en el puerto.
- **El test del llavero real deja `HKCU:\Software\nest-memory` vacía** en Windows (borra el
  valor, no la clave). Inofensiva, pero se limpia con `Remove-Item` sobre esa clave.
