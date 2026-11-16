-- Opción A de docs/superpowers/specs/2026-11-09-rotacion-clave-equipo-design.md (§1.2): el aviso
-- de `20261102000000_membership_sync.sql` sale por pg_net, que NO reintenta. Si el servidor de
-- sync estaba caído al sacar a alguien del equipo, el aviso se perdía y el ex-miembro seguía
-- activo para el sync indefinidamente (baja filas, readopta la maestra, escribe filas de equipo)
-- hasta su próximo registro de máquina.
--
-- Desde acá cada aviso deja una fila en `membership_sync_pendientes` con el id del request de
-- pg_net, y un job de pg_cron cada 5 minutos mira la respuesta en `net._http_response`:
--   - 2xx: el servidor lo aplicó (o lo descartó por viejo, que también es estar al día) → se borra.
--   - otra respuesta, o ninguna después de 5 minutos: se vuelve a avisar. El reintento recalcula
--     el set COMPLETO de ese momento con un `as_of` nuevo, así que reenviar nunca pisa un cambio
--     posterior: el servidor se queda con el más nuevo.
-- Un 401 (secreto mal configurado) se sigue reintentando: cuando se corrige la config, converge.

create extension if not exists pg_cron;

create table if not exists public.membership_sync_pendientes (
  user_id      uuid primary key,
  request_id   bigint,
  intentos     int not null default 0,
  ultimo_envio timestamptz not null default now()
);

-- Sólo la tocan funciones security definer; ningún cliente la ve.
alter table public.membership_sync_pendientes enable row level security;
revoke all on table public.membership_sync_pendientes from public, anon, authenticated;

-- La misma función de 20261102000000, más el registro del request pendiente.
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
  v_req    bigint;
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

  v_req := net.http_post(
    url     := rtrim(v_url, '/') || '/internal/memberships',
    body    := v_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Nest-Signature', 't=' || v_t || ',v1=' || v_sig
    )
  );

  insert into public.membership_sync_pendientes as p (user_id, request_id, intentos, ultimo_envio)
  values (p_user, v_req, 1, now())
  on conflict (user_id) do update
    set request_id = excluded.request_id, intentos = p.intentos + 1, ultimo_envio = now();
end;
$$;

revoke all on function public.notify_membership_sync(uuid) from public, anon, authenticated;

create or replace function public.reintentar_membership_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select p.user_id, p.request_id, p.ultimo_envio, resp.status_code, resp.id is not null as respondio
      from public.membership_sync_pendientes p
      left join net._http_response resp on resp.id = p.request_id
  loop
    if r.status_code between 200 and 299 then
      -- Con el request_id en el where: si un aviso nuevo pisó la fila mientras tanto, queda.
      delete from public.membership_sync_pendientes
       where user_id = r.user_id and request_id is not distinct from r.request_id;
    elsif r.respondio or r.ultimo_envio < now() - interval '5 minutes' then
      perform public.notify_membership_sync(r.user_id);
    end if;
  end loop;
end;
$$;

revoke all on function public.reintentar_membership_sync() from public, anon, authenticated;

-- Con el mismo nombre, `cron.schedule` reemplaza el job: correr la migración dos veces no lo duplica.
select cron.schedule('membership-sync-reintentos', '*/5 * * * *', 'select public.reintentar_membership_sync()');
