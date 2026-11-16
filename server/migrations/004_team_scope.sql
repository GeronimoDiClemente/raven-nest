-- Team Memory Layer 1, Parte 1 — espejo liviano de membresia de equipo.
--
-- La fuente de verdad de quien pertenece a que equipo sigue siendo Supabase
-- (teams/team_members): esta tabla es solo lo que el propio JWT del usuario trajo la
-- ultima vez que registro un device (ver `syncTeamMemberships` en devices.ts). No hay
-- revocacion inmediata: un cambio de membresia en Supabase se refleja aca recien en el
-- proximo registro de device de esa persona (fuera de alcance en esta pasada).
create table if not exists team_memberships (
  user_id     uuid not null references users(id) on delete cascade,
  team_id     uuid not null,
  team_name   text,
  role        text,
  status      text not null,
  synced_at   timestamptz not null default now(),
  primary key (user_id, team_id)
);

-- Sirve el pull team-scoped: "que equipos activos tiene este usuario" (Parte 5 del plan,
-- todavia no implementada).
create index if not exists team_memberships_active on team_memberships (user_id) where status = 'active';

-- NULL sigue siendo "privado al dueno" (el default de hoy, sin cambios). Un proyecto solo
-- queda compartido via POST /v1/projects/share (Parte 3 del plan, todavia no implementada).
alter table projects add column if not exists team_id uuid;

-- Sirve el mismo pull team-scoped, del lado de `projects.team_id in (...)`.
create index if not exists projects_by_team on projects (team_id) where team_id is not null;
