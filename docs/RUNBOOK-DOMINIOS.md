# Runbook — dominios propios

Spec: `docs/superpowers/specs/2026-10-29-dominios-propios-design.md`. Cada paso es una acción
externa: se ejecuta **con el OK de Gero**, y al terminar se anota la fecha y lo que salió.

## A. `sync.nestmux.com` (no depende de D3)

El código ya está en la rama (`092c289`): el default es `https://sync.nestmux.com` y la dirección
de Railway prod es un alias. **No buildear `dist/` hasta cerrar A.3**: el MCP de memoria de los
agentes corre el `dist` del repo y, sin DNS, se queda sin sync.

Hoy (29-10) `sync.nestmux.com` ya resuelve, pero a las IPs de Vercel (`216.198.79.65`,
`64.29.17.1`): hay un registro comodín o de apex que lo atrapa. El CNAME de A.2 lo pisa.

### A.1 Railway: sumar el dominio — [ ] hecho (fecha: …)

Desde `server/` (el link de Railway es por directorio):

```bash
cd server
railway domain sync.nestmux.com --service sync
```

Anotar el **CNAME destino** que devuelve (algo como `xxxx.up.railway.app`) y, si lo pide, el TXT
de verificación. `railway domain status sync.nestmux.com` lo vuelve a mostrar.

### A.2 Vercel DNS — [ ] hecho (fecha: …)

En el dominio `nestmux.com`: `CNAME sync → <destino de A.1>` (y el TXT, si hubo). Por el MCP de
Vercel (`create_record`) o el dashboard.

### A.3 Verificar — [ ] hecho (fecha: …)

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
