# Handoff 2026-11-02 — lanzamiento de Nest Memories (Fase 1)

**Rama:** `feat/memories-settings` (worktree `memory-smoke`), local, **sin push**. No mergear a main.
**pagina-nest:** worktree `C:\Users\gerod\Dev\pagina-nest-link`, rama `feat/link-page` (sobre PR #10), local, sin push.

## Hecho hoy (todo con review por task y review final)

| Bloque | Commits | Doc |
|---|---|---|
| Cifrado obligatorio al conectar | `05e0c4a`..`3457327` | `specs/2026-11-02-cifrado-obligatorio-design.md` |
| Login y compra sin Nest (servidor + CLI) | `7611527`..`c5f0086` | `specs/2026-11-02-login-y-compra-sin-nest-design.md`, `RUNBOOK-LOGIN-SIN-NEST.md` |
| Páginas `/link` y `/upgrade` (pagina-nest) | `f4752d4`, `9eace62`, `58de0ac` | mismo spec §4–5 |
| MCP dentro de Nest ("Nest is not running") | `6c79e09`, `aa50c4d`, `b2db771` | causa: Nest instalado 1.5.1 sin Memories; el MCP ahora descubre a Nest por disco |
| Spec de la TUI — **aprobado por Gero** | `c1f4695` | `specs/2026-11-02-tui-de-memory-design.md` |

Suite completa en verde al cierre del bloque MCP: raíz 4355 tests, servidor 566.

## Próximo paso (mañana)

1. **TUI:** spec aprobado → `writing-plans` → ejecución (Gero elige método).
2. **Claude Desktop en `setup`:** diseño corto aparte (path de `claude_desktop_config.json` por SO y proyecto de una sesión sin carpeta).
3. Brainstorm "Nest para no programadores".

## Pendientes externos (cada uno con OK de Gero)

- Runbook de login: `TRUST_PROXY=1` (verificar proxy de Railway), Redirect URLs de Supabase `/link**` y `/upgrade**`, `LINK_WEB_ORIGINS`, migración 014, redeploy de `stripe-checkout`, `PUBLIC_SYNC_BASE_URL` en Vercel, mergear PR #10 y después `feat/link-page`.
- Fase 2: org npm `nestmux` y publicar el plugin, `.vsix`, Stripe live (Cloud 15/144), deploy Railway prod (clientes primero, servidor último — `server/README.md`), migraciones Supabase + Vault.
- Pasar las ramas de la Mac (al cierre de la sesión diaria; requiere push con OK).

## Recuperación

- Ledgers SDD respaldados en el scratchpad de la sesión (`sdd-cifrado-obligatorio-backup`, `sdd-login-sin-nest-backup`); los commits nombrados existen en git.
- Para guardar en memoria real en esta PC hace falta un Nest con Memories (la beta): el 1.5.1 instalado no inyecta `NEST_MEMORY_SOCKET`/`TOKEN`.
