# Beta 1.6.0-beta.1 — qué falta y en qué orden

Relevado el 2026-11-12 contra GitHub y Railway. Lo que se puede hacer desde código ya está hecho:
la rama `feat/memories-settings` pasó CI (PR #33 en borrador, **no mergear**), y las ramas del
30-oct (webhook de Stripe, preload) están integradas. Lo que queda es configuración y deploy.

## 0. La decisión del orden: el server puede ir ANTES

`server/README.md` ("Orden de despliegue") pide la app primero porque el server nuevo rechaza
memoria personal en claro y frenaría a los clientes viejos. **Hoy no hay clientes viejos que
frenar**: la v1.5.1 instalada no trae el subsistema de memoria (`electron/memory-daemon.ts` no
existe en el tag `v1.5.1`), así que no sincroniza nada. Los únicos que hablan con prod son los
builds de desarrollo, que ya cifran, y el paquete `@nestmux/memory`, que no está publicado.

Y la beta lo necesita: los links de descarga (`/beta/<link>`) los sirve el server, y los
arreglos de seguridad de noviembre (ex-miembro de equipo, envolturas, carrera del espejo) sólo
protegen con el server nuevo. Prod corre el deploy del 29-oct.

## 1. Cloudflare R2: el bucket de betas

- Crear un bucket **privado** para las betas (por ejemplo `nest-betas`), distinto del de backups.
- Un token de R2 con lectura y escritura sobre ese bucket.

## 2. GitHub: secretos que lee `release.yml` con `canal=beta`

Faltan los cuatro (verificado con `gh secret list`, ni en el repo ni en el environment `beta`):

```bash
R=GeronimoDiClemente/raven-nest
gh secret set R2_ACCOUNT_ID            --repo $R --env beta
gh secret set R2_BETAS_BUCKET          --repo $R --env beta
gh secret set R2_BETAS_ACCESS_KEY_ID   --repo $R --env beta
gh secret set R2_BETAS_SECRET_ACCESS_KEY --repo $R --env beta
```

Firmar y notarizar usa los secretos del repo, que ya están (`APPLE_API_*`, `MAC_CSC_*`).
No borrar `APPLE_API_*`: con ellos notarizó la 1.5.1.

## 3. Railway (servicio `sync`): variables

Ya están `BETA_LINK_SECRET`, `PLAN_SYNC_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` y las
`R2_*` de backups. Falta:

```bash
cd server
railway variables --service sync --set R2_BETAS_BUCKET=<el bucket del paso 1>
```

`betas.ts` usa `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`, las mismas de los
backups: el token de esas variables tiene que poder **leer** el bucket de betas. Si es un token
sólo del bucket de backups, ampliarlo o crear uno nuevo.

## 4. Deploy del server

```bash
cd server && railway up --service sync --detach
```

Verificar, en este orden:

- Las migraciones corren solas al arrancar. En los logs tienen que aparecer hasta `016`.
- `curl -s https://sync-production-54ba.up.railway.app/health` → `{"ok":true}`.
- `curl -s https://sync-production-54ba.up.railway.app/health/backup` → 200. Un 503 quiere decir
  que no hay backup bueno en 26 h.
- `POST /internal/plan` firmado con un cuerpo inválido → **400** (no 404). Un 404 quiere decir
  que falta `PLAN_SYNC_SECRET`.

## 5. Supabase, recién con el server nuevo arriba

1. Migraciones pendientes, en orden: `20261029000000_profiles_billing_period`,
   `20261102000000_membership_sync` y `20261112000000_membership_sync_reintentos`. Esta última
   usa `pg_cron`: si falla al crear la extensión, habilitarla en Dashboard › Database ›
   Extensions y volver a correrla.
2. El Vault: el mismo valor de `PLAN_SYNC_SECRET` que tiene Railway.
   ```sql
   select vault.create_secret('https://sync-production-54ba.up.railway.app', 'plan_sync_url');
   select vault.create_secret('<PLAN_SYNC_SECRET>', 'plan_sync_secret');
   ```
3. Si la beta cobra: los `STRIPE_PRICE_CLOUD_*` en los secretos de las edge functions
   (`docs/RUNBOOK-PAGAR-CLOUD.md`).

Prueba de que el aviso de membresías anda: sacar y volver a poner a alguien de un equipo de
prueba. `select * from public.membership_sync_pendientes` tiene que vaciarse en ≤ 5 minutos.

## 6. Disparar la beta

```bash
gh workflow run release.yml --repo GeronimoDiClemente/raven-nest --ref feat/memories-settings -f canal=beta
```

Sube los instaladores al bucket privado, no a GitHub. Cada tester de la allowlist baja la suya
desde su link personal `/beta/<link>`.

## Antes de abrirla a gente de afuera

- Revocar los `github_token` de `profiles` (la policy ya está cerrada; los tokens que se
  leyeron siguen vivos).
- Probar a mano el login con Google, GitHub y GitLab (PKCE), el registro y el reset.
- Pasar la clave age (`~/nest-supabase-backup.key`) a 1Password.
