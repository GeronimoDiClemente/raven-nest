# Runbook — dominios propios

Spec: `docs/superpowers/specs/2026-10-29-dominios-propios-design.md`. Cada paso es una acción
externa: se ejecuta **con el OK de Gero**, y al terminar se anota la fecha y lo que salió.

## A. `sync.nestmux.com` (no depende de D3)

El código ya está en la rama (`092c289`): el default es `https://sync.nestmux.com` y la dirección
de Railway prod es un alias. **No buildear `dist/` hasta cerrar A.3**: el MCP de memoria de los
agentes corre el `dist` del repo y, sin DNS, se queda sin sync.

Antes del CNAME, `sync.nestmux.com` resolvía a las IPs de Vercel por el `ALIAS *` (ver A.2).

### A.1 Railway: sumar el dominio — [x] hecho (29-10, 23:46 UTC)

Desde `server/` (el link de Railway es por directorio):

```bash
cd server
railway domain sync.nestmux.com --service sync
```

Anotar el **CNAME destino** que devuelve (algo como `xxxx.up.railway.app`) y, si lo pide, el TXT
de verificación. `railway domain status sync.nestmux.com` lo vuelve a mostrar.

Salió: id `50926acb-072d-457e-9661-6a1040f6fc81`, `CNAME sync → xnoo6nb5.up.railway.app` y
`TXT _railway-verify.sync`.

### A.2 Vercel DNS — [x] hecho (29-10)

En el dominio `nestmux.com`: `CNAME sync → <destino de A.1>` (y el TXT, si hubo). Por el MCP de
Vercel (`create_record`) o el dashboard.

Ojo: el dominio vive en el team `geronimodiclemente-gmailcoms-projects`
(`team_cCW7bfitUfTw9QTPSAs3tetE`). Sin el `teamId`, el MCP contesta 403. Hay un `ALIAS *` que
Vercel maneja solo: es lo que atrapaba a `sync` antes del CNAME. El CAA permite Let's Encrypt,
que es lo que usa Railway.

### A.3 Verificar — [x] hecho (29-10: DNS a Railway, HTTP/2 401 con certificado válido)

```bash
dig +short sync.nestmux.com          # tiene que dar el destino de Railway, no las IPs de Vercel
curl -si https://sync.nestmux.com/v1/sync/status | head -1   # → 401 (ruta viva, sin token)
railway domain status sync.nestmux.com   # certificado emitido
```

Recién con las tres en verde: `npm run build` y probar que la app conectada sincroniza.

### A.4 Builds de desarrollo

`MAIN_VITE_SUPABASE_URL` ya no se lee. Quien tenga en su `.env` esa línea apuntando a Railway prod
puede borrarla (el default ya es el mismo servidor); para un servidor local, `MAIN_VITE_SYNC_URL`.

## B. `api.nestmux.com` — espera D3

No se toca hasta que Gero apruebe Supabase Pro + Custom Domain (spec §4.2 y D3).

## C. Railway después del incidente del 20 al 22 de octubre

Railway descifró variables de entorno de un subconjunto de workspaces (su informe preliminar:
https://blog.railway.com/p/preliminary-report-october-security-incident) y pide rotarlas.
El 29-10 el servicio `sync` tenía `BETA_LINK_SECRET`, `DATABASE_URL`, `SUPABASE_URL` y
`SUPABASE_ANON_KEY`. La anon key es pública por diseño, y la base no tiene endpoint público.

- [x] Rotar `BETA_LINK_SECRET` (29-10). No cortó nada, porque la beta no estaba activa en prod (faltan `R2_BETAS_BUCKET`/`R2_*`).
- [x] Rotar la contraseña de Postgres (29-10). Antes se sacó un dump manual: 13 tablas, prod tenía 6
  usuarios y 0 memorias. Orden usado, sin corte:
  1. `ALTER ROLE CURRENT_USER WITH PASSWORD` por `railway ssh` al contenedor `sync`.
  2. `POSTGRES_PASSWORD` y `PGPASSWORD` del servicio Postgres con `railway variable set --stdin --skip-deploys`.
     La `DATABASE_URL` de los dos servicios es referencia y tomó la nueva sola.
  3. `railway redeploy --service sync`. `/health` respondió 200 tras migrar.
- [ ] Renovar el token del CLI de Railway y revisar los accesos de GitHub.
- [x] `R2_*` cargadas (29-10). Bucket `nest-memory-backups` en Cloudflare, con regla de ciclo de vida
  `30-dias` y un token de cuenta con Object Read & Write sólo sobre ese bucket. El primer backup salió
  al arrancar (`nest-memory/2026-10-30T01-36-22-004Z.dump`) y el restore se verificó con
  `npx tsx scripts/restore-check.mjs --from-r2` adentro del contenedor: OK.
- [ ] `PLAN_SYNC_SECRET`: va con el deploy del código nuevo (2b-2).
- [ ] Backups y PITR de Railway: **requieren el plan Pro** (USD 20/mes). Postergado: mientras tanto alcanza con R2, que además queda fuera de Railway.
- [ ] Releer el informe final de Railway. Si confirma acceso a código o a volúmenes, reabrir la mudanza.

La validación completa (alternativas, costos y disparadores) está en `docs/railway-validacion-2026-10-29.md`.
