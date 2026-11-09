# Runbook: backup de Supabase

Supabase en el plan free no hace backups. Ahí viven las cuentas (`auth.users`), los perfiles con
el plan, los equipos y las membresías: si se pierde la base, nadie puede entrar y los pagos
quedan sin dueño. La memoria está a salvo aparte (el servicio de sync tiene su propio backup,
`server/README.md` §11.3), pero sin cuentas no hay quién la abra.

`.github/workflows/backup-supabase.yml` corre todas las noches a las 05:30 UTC:

1. Hace el dump con la receta oficial de Supabase: `roles.sql`, `schema.sql` y `data.sql`.
2. **Verifica** que `auth.users`, `profiles`, `teams` y `team_members` tengan en el dump por
   lo menos las filas que tiene la base. Si no, falla y no sube nada.
3. Lo **cifra con age** usando sólo la clave pública. Ni GitHub ni R2 pueden abrirlo: trae
   emails, el `github_token` de cada perfil y los ids de Stripe.
4. Lo sube a R2 como `supabase/supabase-<fecha>.tar.gz.age`, más su `.sha256`.

## Configuración (una vez)

Depende de que exista el environment `release` (`docs/RUNBOOK-ENVIRONMENTS.md`, pasos 1 y 2).

**1. El par de claves de age.**
```bash
brew install age
age-keygen -o nest-supabase-backup.key   # imprime la pública: age1...
```
Guardar el archivo entero (la PRIVADA) en 1Password y borrarlo del disco. Sin ella los backups
no se pueden abrir: perder la privada es perder todos los backups.

**2. El bucket en R2** (dashboard de Cloudflare → R2):
- Un bucket privado, por ejemplo `nest-supabase-backups`.
- Un API token **Object Read & Write limitado a ese bucket**. R2 no tiene un permiso de "sólo
  escribir"; lo que impide que alguien con el token borre los backups es el punto siguiente.
- **Bucket lock**: una regla de retención de 30 días sobre el prefijo `supabase/`. Durante esos
  30 días nadie puede borrar ni pisar un backup, tampoco con el token. Es la respuesta al punto
  6 de la revisión ("token de R2 sólo para subir") y conviene ponerle la misma regla al bucket
  de backups del servicio de sync.
- Una lifecycle rule que borre los objetos de `supabase/` a los 90 días.

**3. La URL de la base.** Dashboard de Supabase → Connect → **Session pooler**: los runners de
GitHub no tienen IPv6 y la conexión directa (`db.<ref>.supabase.co`) es sólo IPv6. Tiene la forma
`postgresql://postgres.<ref>:<contraseña>@aws-0-<región>.pooler.supabase.com:5432/postgres`, con
la contraseña *percent-encoded*.

**4. Los secrets**, en el environment `release`:
```bash
R=GeronimoDiClemente/raven-nest
gh secret set SUPABASE_DB_URL --env release --repo $R
gh secret set BACKUP_AGE_RECIPIENT --env release --repo $R      # la pública, age1...
gh secret set R2_SUPABASE_BACKUP_ACCESS_KEY_ID --env release --repo $R
gh secret set R2_SUPABASE_BACKUP_SECRET_ACCESS_KEY --env release --repo $R
gh secret set R2_SUPABASE_BACKUP_BUCKET --env release --repo $R
gh secret set R2_ACCOUNT_ID --repo $R                           # si todavía no está
```

**5. La primera corrida, a mano:**
```bash
gh workflow run backup-supabase.yml --repo $R
gh run watch --repo $R
```
El paso "Verificar el dump contra la base" imprime las filas de cada tabla. Si `auth.users` da
0, el usuario de la URL no tiene permiso sobre `auth`: usar el `postgres` del pooler, no otro.

**Si falla una noche:** GitHub le manda un mail a quien modificó por última vez el `cron` del
workflow. Ese aviso es el monitor; no hay otro.

## Restaurar

```bash
aws s3 cp s3://<bucket>/supabase/supabase-<fecha>.tar.gz.age . \
  --endpoint-url https://<account>.r2.cloudflarestorage.com
sha256sum -c supabase-<fecha>.tar.gz.age.sha256      # contra el .sha256 bajado igual
age -d -i nest-supabase-backup.key supabase-<fecha>.tar.gz.age | tar -xzf -
```

En un proyecto de Supabase **nuevo** (nunca sobre el de producción), la receta oficial:
```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NUEVA_DB_URL"
```

Después de restaurar hay que reapuntar `SUPABASE_URL` y las claves: en Railway (servicio de
sync), en los secrets de las functions y en el build de la app (`VITE_SUPABASE_URL`). Las
sesiones viejas no sirven, porque el proyecto nuevo firma con otra clave: todos vuelven a
entrar con su cuenta.

**Simulacro.** Un backup que nunca se restauró es una hipótesis. Hacer la restauración entera
en un proyecto de prueba una vez, apenas ande la primera corrida, y anotar acá la fecha:

- Simulacro: _pendiente_
