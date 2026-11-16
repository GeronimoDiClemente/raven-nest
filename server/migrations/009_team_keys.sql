-- Cifrado de memoria de equipo — spec 2026-10-14-cifrado-de-equipo-design.md.
-- Mismo patrón que 006_e2ee.sql (device_keys/key_wraps), sin épocas: v1 no rota la clave
-- de equipo (spec §2, §8) y la activa SIEMPRE el `leader` (team_memberships.role).

create table if not exists team_keys (
  team_id      uuid primary key,
  activated_by uuid not null references users(id),
  activated_at timestamptz not null default now()
);

-- Una fila por destinatario de la clave de equipo. `slot` es el device_id (como texto) o el
-- literal 'recovery' — mismo espacio de nombres que key_wraps, mismo motivo: el código de
-- recuperación es un destinatario más, no un caso especial.
create table if not exists team_key_wraps (
  team_id    uuid not null references team_keys(team_id) on delete cascade,
  slot       text not null,
  kind       text not null check (kind in ('device', 'recovery')),
  wrapped    text not null,
  wrap_meta  jsonb,
  created_at timestamptz not null default now(),
  primary key (team_id, slot)
);

create index if not exists team_key_wraps_by_team on team_key_wraps (team_id);
