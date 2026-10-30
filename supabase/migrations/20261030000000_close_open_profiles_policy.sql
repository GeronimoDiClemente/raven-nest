-- Cierra la policy «Service role can upsert profiles», que en prod valía para TODOS los roles
-- (`public`, o sea anon y authenticated) con `using (true)` y `with check (true)`.
--
-- No estaba en ninguna migración: se creó a mano en el dashboard. Verificado el 2026-10-29 con
-- la anon key, la pública que va adentro de la app: cualquiera podía contar los 94 perfiles,
-- leer `github_token`/`gitlab_token` de todos y hacer UPDATE o DELETE de cualquier fila. Las
-- policies se suman con OR, así que las de «own profile» no frenaban nada.
--
-- El nombre era un malentendido: el service role saltea RLS, no necesita policy. Lo que
-- escribe `profiles` desde afuera del service role es siempre el dueño de la fila (main.tsx,
-- useGitHub.ts, github-oauth y gitlab-oauth con el token del usuario), y eso lo cubre
-- «Users can update own profile». Las filas nuevas las crea `handle_new_user()` (security
-- definer) u `on-signup` (service role).
DROP POLICY IF EXISTS "Service role can upsert profiles" ON public.profiles;

-- Segunda capa, independiente de las policies: ningún cliente crea ni borra perfiles. Si
-- mañana alguien vuelve a sumar una policy amplia desde el dashboard, esto sigue cerrando
-- INSERT y DELETE.
REVOKE INSERT, DELETE ON public.profiles FROM anon, authenticated;
