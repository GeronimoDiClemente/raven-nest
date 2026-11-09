# Runbook: los environments `release` y `beta` de GitHub

**Por qué.** Hasta el 2026-11-09 todos los secrets eran del repo: cualquier job de cualquier rama
los leía. Quien pudiera pushear una rama editaba un workflow, lo disparaba y se llevaba el
certificado de firma, las credenciales de Apple, el token de Supabase y la clave de Stripe. El
chequeo de "una estable sólo sale de main" en `release.yml` frena el error, no a quien edita el
archivo en su rama. Eso sólo lo frena un secret que GitHub no le entrega a esa rama.

Los workflows ya declaran los environments (commit de este runbook). **Mientras los secrets
sigan en el repo no cambia nada**: un job con `environment:` lee igual los secrets del repo. La
protección empieza cuando se hacen los pasos de abajo.

## Qué va en cada uno

| Environment | Ramas | Revisor | Secrets |
|---|---|---|---|
| `release` | sólo `main` | **no** (ver abajo) | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `SUPABASE_ACCESS_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, y los del backup de Supabase (`SUPABASE_DB_URL`, `BACKUP_AGE_RECIPIENT`, `R2_SUPABASE_BACKUP_*`, ver `docs/RUNBOOK-BACKUP-SUPABASE.md`) |
| `beta` | cualquiera | **sí** | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `R2_BETAS_ACCESS_KEY_ID`, `R2_BETAS_SECRET_ACCESS_KEY`, `R2_BETAS_BUCKET` |
| (repo) | — | — | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `MAIN_VITE_GITHUB_CLIENT_ID`, `MAIN_VITE_GITLAB_CLIENT_ID`, `R2_ACCOUNT_ID` — son públicos de hecho: viajan dentro de la app |

**`release` sin revisor, a propósito.** `staple-pending-releases.yml` corre cada 10 minutos,
`check-mac-staple.yml` cada 2 horas y `backup-supabase.yml` cada noche, todos con secrets de `release`: con un revisor
quedarían esperando una aprobación para siempre. Lo que protege a `release` es la regla de
ramas: un job de otra rama no recibe sus secrets. Quien puede pushear a `main` ya puede
publicar, así que un revisor no agrega mucho ahí.

**`beta` con revisor.** Corre desde cualquier rama y firma con el mismo certificado: sin
revisor, la regla de ramas no protegería nada. Una beta pide dos aprobaciones: una cuando
arrancan los builds de Mac y Windows y otra cuando arranca la subida a R2.

## Pasos (una vez)

```bash
R=GeronimoDiClemente/raven-nest

# 1. `release`: sólo la rama main.
gh api -X PUT repos/$R/environments/release --input - <<'EOF'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
EOF
gh api -X POST repos/$R/environments/release/deployment-branch-policies -f name=main -f type=branch

# 2. `beta`: cualquier rama, con vos como revisor.
ID=$(gh api user --jq .id)
gh api -X PUT repos/$R/environments/beta --input - <<EOF
{ "reviewers": [{ "type": "User", "id": $ID }], "deployment_branch_policy": null }
EOF

# 3. Cargar los secrets en cada environment (los valores, de 1Password). Uno por uno:
gh secret set MAC_CSC_LINK --env release --repo $R      # pide el valor por stdin
# ...repetir con cada nombre de la tabla, en `release` y en `beta`.
```

4. **Probar antes de borrar nada**: una release real desde `main`, o `gh workflow run
   "Check Apple Notary Status" --repo $R`, que usa `release`. Tiene que andar.
5. **Recién ahí borrar los del repo**, que hasta entonces tapan el agujero sin protección:
   ```bash
   for s in MAC_CSC_LINK MAC_CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID \
            SUPABASE_ACCESS_TOKEN STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
     gh secret delete "$s" --repo $R
   done
   ```

## Lo que se encontró al armarlo (2026-11-09)

- **`WIN_CSC_*` y `R2_BETAS_*` no existen en el repo.** El instalador de Windows sale sin
  firmar y el canal beta nunca pudo subir nada. Se cargan directo en los environments.
- **`GIT_CRYPT_KEY` sigue en el repo** y ningún workflow la usa: el repo ya no usa git-crypt.
  Borrarla.
- **`APPLE_API_KEY`, `APPLE_API_KEY_ID` y `APPLE_API_ISSUER` tampoco los usa ningún
  workflow** (la notarización va con Apple ID + contraseña de app). Borrarlos, o moverlos a
  `release` si se piensa pasar a la API key.
- `build.yml` (el build de diagnóstico) declara `release` en el job de Windows: firma sólo si
  se dispara desde `main`. Desde otra rama ese job no arranca.
