# Handoff — Cifrado de memoria de equipo (15 de octubre de 2026)

Para seguir desde cualquier máquina. Rama: **`feat/nest-terminal-ui`**, todo commiteado y
pusheado. **Sin release**: no se tocó `package.json`. **Sin deploy**: el servidor de sync de
Railway NO tiene nada de esto (migraciones `009`/`010` incluidas).

```bash
git fetch origin && git checkout feat/nest-terminal-ui && git pull
npm install            # deja el binding de Electron
```

Documentos (los dos versionados con `-f`, `docs/superpowers` está gitignored):
- Spec: `docs/superpowers/specs/2026-10-14-cifrado-de-equipo-design.md`
- Plan (Tasks 1-15b): `docs/superpowers/plans/2026-10-14-cifrado-de-equipo.md`
- Ledger de la ejecución (reviews por task, bugs encontrados, fix rounds):
  `docs/superpowers/plans/2026-10-14-cifrado-de-equipo-ledger.md` — copia del
  `.superpowers/sdd/.../progress.md` local, que está ignorado por diseño.

---

## Estado

**El feature está completo y revisado de punta a punta.** Ejecución subagent-driven del plan,
del spec `9886529` al `HEAD`. Cada task tuvo su review; al final hubo una review de toda la
rama (2 Critical + 5 Important, todos arreglados en Task 15) y una review de seguridad de
Task 15 (2 Important + 5 Minor, arreglados en Task 15b).

| tramo | qué |
|---|---|
| Tasks 1-12 | servidor (schema `team_keys`/`team_key_wraps`, rol leader, activate/authorize, recrypt) + cliente (crypto, recovery code, wiring en `memory-envelope.ts`, migración retroactiva, IPC, `TeamEncryptionCard`) |
| Task 13 (`6e9ab96`, `0a849ae`) | e2e real `e2e/16-cifrado-de-equipo.spec.ts`. Encontró una carrera: un pull en vuelo pisaba el reset de cursores del adopt |
| Task 14 (`e3071fc`..`d429c8a` + `a8872f1`..`9836262`) | el servidor manda `team_id` en las filas de equipo del pull (el compañero que no compartió su copia no podía descifrar); `encrypted_teams` en status; gate fail-closed `team_key_missing` en el push; rechazo `team_encryption_required` en el servidor; readopción automática de la clave de equipo al arrancar. **Cierra spec §9.4** |
| Task 15 (`e391524`..`a1ace4b`) | C1: la migración no re-cifraba lo de proyectos que el leader no clonó → `GET /v1/teams/key/recrypt-pending`. C2: prueba de posesión de la maestra (`team_keys.verifier`, migración `010`) para authorize/recrypt, y el cliente verifica la maestra que adopta. Más: stale/already_sealed, content null, recrypt automático al activar con errores visibles, TOCTOU de huella (**también en el personal**), `.gitignore` de `.superpowers/sdd` restaurado |
| Task 15b (`753e0c9`..`6598b8f`) | regenerar el par de claves borra las envolturas de equipo; la migración sella `topic_key`; un único criterio de "en claro"; tope de bytes en pending; `isLeader` en `GET /v1/teams/key` |

Verificado al cerrar (Windows): typecheck de CI 0/0, unitarios **3719** en verde, servidor
**445/445**, e2e `16` (`--repeat-each=2`), `13` y `04-contraste` en verde.

---

## Pendiente — decisiones de Gero

1. **Re-share entre equipos.** Si un proyecto ya compartido con un equipo que cifra se
   re-comparte con otro equipo (`share.ts` hace `update set team_id` sin chequeo), las filas
   viejas quedan ilegibles para todos. Opciones: prohibirlo en el servidor (**recomendado**,
   lo más simple), re-cifrar como parte del re-share, o guardar en cada fila con qué equipo se
   selló.
2. **Supersede LOCAL de equipo (bug previo).** Al guardar, `main.ts` calcula el HMAC local del
   tema con la clave PERSONAL también para filas `team`; no coincide con el HMAC de equipo que
   baja del pull. En la app no se reemplazan versiones de un mismo tema de autores distintos
   (en el servidor sí). Arreglo chico: usar la clave de equipo para filas de equipo.
3. **Pushear/mergear y deployar** el servicio con las migraciones `009`/`010`.

## Follow-ups menores (anotados, sin tocar)

- Orden de locks invertido recrypt (fila→proyecto) vs push (proyecto→fila): Postgres puede
  abortar una con deadlock; se autocorrige en la próxima corrida.
- M3: el contador de resets de cursores es por proceso; dos procesos sobre la misma base
  (app + paquete portátil) pueden pisarse.
- M5: un cliente pre-Task 14 trata `team_encryption_required` como terminal (irrelevante hoy:
  el cifrado de equipo nunca salió).
- No hay contador en la UI de memorias de equipo retenidas esperando autorización.
- El paquete portátil (`npx nest-memory`) no tiene claves de equipo: lo de equipos que cifran
  queda retenido hasta que la app lo suba. Correcto, pero hay que anunciarlo.
- Un operador del servidor activo puede reemplazar envoltura y verifier juntos; contra eso
  sólo están las huellas (mismo límite que el personal).

---

## Cómo correr las pruebas

- **Binding nativo**: `npm run native:node` antes de `vitest`/`npm test`;
  `npm run native:electron` antes de buildear o lanzar la app. Un `NODE_MODULE_VERSION`
  mismatch es el binding equivocado, no una regresión.
- **Postgres de prueba**: `docker start nest-memory-pg` (crearlo con el `docker run` de
  `server/README.md` si no existe en esa máquina). Los tests del servidor lo necesitan.
- **Servidor de sync local**: `cd server && PORT=8099 npx tsx src/index.ts`.
- **e2e de cifrado**:
  ```bash
  npm run native:electron && npm run build
  NEST_E2E_SYNC_URL=http://127.0.0.1:8099 NEST_E2E_PG_DOCKER=nest-memory-pg \
    npx playwright test e2e/16-cifrado-de-equipo.spec.ts e2e/13-equipo-dos-cuentas.spec.ts
  ```
- `llavero-real` (llavero real del SO) y algunos tests jsdom fallan por timeout con la
  máquina cargada; aislados pasan. En la PC Windows la RAM venía justa: no correr dos e2e ni
  dos suites a la vez.
- Al terminar, matar el servidor de sync y los `electron.exe` que hayas lanzado (no los
  `memory-mcp.js` de las sesiones de Claude).
