-- Cifrado del lado del cliente (spec 2026-09-09 §5.3, camino B). El servicio guarda
-- claves PUBLICAS y blobs SELLADOS: nada de esto le sirve para leer una memoria.

-- La publica X25519 de cada maquina, publicada por ella misma con su propio device token.
create table if not exists device_keys (
  device_id   uuid primary key references devices(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  public_key  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Sirve "que maquinas de esta cuenta puedo autorizar", que es el unico query que se hace.
create index if not exists device_keys_by_user on device_keys (user_id);

-- Una fila por destinatario de la clave maestra. `slot` es el device_id (como texto) o el
-- literal 'recovery'. Un solo espacio de nombres a proposito: el codigo de recuperacion es
-- un destinatario mas, no un caso especial con su propia tabla.
create table if not exists key_wraps (
  user_id    uuid not null references users(id) on delete cascade,
  slot       text not null,
  kind       text not null check (kind in ('device', 'recovery')),
  key_epoch  integer not null,
  wrapped    text not null,
  -- Solo para 'recovery': la sal de scrypt. No es secreta.
  wrap_meta  jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create index if not exists key_wraps_by_epoch on key_wraps (user_id, key_epoch);

-- 0 = esta cuenta no tiene el cifrado activado. Es lo que el cliente mira para saber si
-- tiene que cifrar antes de pushear.
alter table users add column if not exists key_epoch integer not null default 0;
