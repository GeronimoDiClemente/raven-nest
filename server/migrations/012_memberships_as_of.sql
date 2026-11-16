-- Hueco del 30-oct: Supabase avisa los cambios de membresía con `POST /internal/memberships`.
-- Cada aviso trae el set completo y el momento en que se calculó (`as_of`, ms). Se guarda el
-- último aplicado para ignorar uno más viejo que llegue después (pg_net no garantiza orden).
--
-- Nullable: null = nunca llegó un aviso, y entonces el primero aplica siempre.
alter table users add column if not exists memberships_as_of bigint;
