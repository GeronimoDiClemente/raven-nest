-- Vincular una máquina SIN navegador (spec del paquete portátil §7).
--
-- `/v1/devices` exige un JWT de Supabase, o sea un login por navegador. Una CLI que corre por
-- `npx` en un servidor remoto o en una terminal no tiene dónde abrirlo, así que hace falta el
-- rodeo clásico: la máquina sin navegador muestra un código corto, el usuario lo aprueba desde
-- otra donde SÍ tiene sesión, y la primera pregunta hasta que aparezca su token.
--
-- Dos códigos y no uno, que es lo único realmente delicado de esta tabla: `user_code` es el
-- que se muestra en pantalla y lo ve cualquiera que mire por encima del hombro, y
-- `device_code_hash` es el secreto con el que se reclama el token. Si fueran el mismo, mirar
-- la pantalla alcanzaría para robarse la credencial en el momento en que el usuario aprueba.
-- El segundo se guarda hasheado por la misma razón que `devices.token_hash`: el servicio no
-- tiene por qué poder reconstruir una credencial de nadie.
create table if not exists link_requests (
  id                uuid primary key,
  user_code         text not null,
  device_code_hash  text not null,
  -- Se llena al aprobar. Nulo = todavía nadie lo reclamó como suyo.
  --
  -- SIN clave foránea a `users`, y no por descuido: quien crea la fila de `users` es
  -- `registerDevice`, o sea el RECLAMO, que pasa después. Una cuenta que vincula su primera
  -- máquina todavía no existe del lado del servicio cuando aprueba, y con la foránea puesta
  -- ese caso —el primero que va a ocurrir en la vida de cada usuario— fallaba. Ponerla
  -- obligaría a que aprobar cree el usuario, y aprobar no tiene que crear nada: es lo que
  -- deja la emisión del token, con sus controles, en un solo lugar.
  user_id           uuid,
  email             text,
  approved_at       timestamptz,
  -- Se llena al entregar el token. Un pedido consumido no vuelve a entregar nada.
  consumed_at       timestamptz,
  -- Para el `muy-seguido`: sin esto, un cliente con un bucle apretado puede golpear el
  -- endpoint sin límite y encima gastar una conexión por vuelta.
  last_polled_at    timestamptz,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null
);
create unique index if not exists link_requests_by_user_code on link_requests (user_code);
create unique index if not exists link_requests_by_device_code on link_requests (device_code_hash);
-- Los vencidos se barren aparte; el índice es para ese barrido y para no escanear la tabla
-- entera cuando crezca.
create index if not exists link_requests_by_expiry on link_requests (expires_at);
