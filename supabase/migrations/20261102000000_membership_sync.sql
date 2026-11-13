-- Hueco del 30-oct: un miembro sacado de un equipo seguía bajando la memoria del equipo,
-- porque el servidor de sync sólo refrescaba su espejo `team_memberships` al registrar una
-- máquina. Desde acá, cada cambio en `team_members` le avisa al servidor de sync con
-- `POST /internal/memberships` (server/src/membership-sync.ts), firmado igual que el aviso de
-- plan: `X-Nest-Signature: t=<seg>,v1=HMAC-SHA256(PLAN_SYNC_SECRET, "<t>.<cuerpo crudo>")`.
--
-- El aviso lleva el set COMPLETO de equipos activos del usuario en ese momento, no el cambio:
-- si llegan desordenados, el servidor se queda con el de `as_of` más nuevo y converge.
--
-- Configuración (una vez por proyecto, NO va en git): dos secretos en Vault, los mismos
-- valores que las env vars `PLAN_SYNC_URL` / `PLAN_SYNC_SECRET` de las edge functions:
--   select vault.create_secret('<url base del sync>', 'plan_sync_url');
--   select vault.create_secret('<secreto>', 'plan_sync_secret');
-- Sin esos secretos la función no hace nada (entornos locales y de test siguen igual).
--
-- Límite conocido: pg_net no reintenta. Si el sync está caído en ese momento, el aviso se
-- pierde y el espejo se corrige recién en el próximo registro de máquina de ese usuario.

create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.notify_membership_sync(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_body   jsonb;
  v_crudo  text;
  v_t      bigint;
  v_sig    text;
begin
  if p_user is null then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'plan_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'plan_sync_secret';
  if v_url is null or v_secret is null or v_url = '' or v_secret = '' then
    return;
  end if;

  v_body := jsonb_build_object(
    'user_id', p_user,
    'as_of', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', tm.team_id, 'team_name', t.name, 'role', tm.role))
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
       where tm.user_id = p_user and tm.status = 'active'
    ), '[]'::jsonb)
  );
  -- Se firma `jsonb::text` porque es exactamente lo que `net.http_post` serializa y manda
  -- como cuerpo (convert_to(body::text, 'UTF8')): el servidor verifica sobre los bytes crudos.
  v_crudo := v_body::text;
  v_t := floor(extract(epoch from clock_timestamp()))::bigint;
  v_sig := encode(extensions.hmac(v_t::text || '.' || v_crudo, v_secret, 'sha256'), 'hex');

  perform net.http_post(
    url     := rtrim(v_url, '/') || '/internal/memberships',
    body    := v_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Nest-Signature', 't=' || v_t || ',v1=' || v_sig
    )
  );
end;
$$;

-- Lee Vault: sólo la llama el trigger, nunca un cliente.
revoke all on function public.notify_membership_sync(uuid) from public, anon, authenticated;

create or replace function public.team_members_membership_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_membership_sync(new.user_id);
  elsif tg_op = 'DELETE' then
    perform public.notify_membership_sync(old.user_id);
  elsif new.user_id is distinct from old.user_id
     or new.team_id is distinct from old.team_id
     or new.status  is distinct from old.status
     or new.role    is distinct from old.role then
    -- Al aceptar una invitación `user_id` pasa de null al usuario; si cambia de dueño, avisan
    -- los dos. `notify_membership_sync(null)` no hace nada.
    perform public.notify_membership_sync(new.user_id);
    if old.user_id is distinct from new.user_id then
      perform public.notify_membership_sync(old.user_id);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.team_members_membership_sync() from public, anon, authenticated;

drop trigger if exists team_members_membership_sync on public.team_members;
create trigger team_members_membership_sync
  after insert or update or delete on public.team_members
  for each row execute function public.team_members_membership_sync();
