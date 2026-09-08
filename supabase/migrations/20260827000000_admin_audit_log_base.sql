-- `admin_audit_log` se habia creado a mano en la base de prod y nunca tuvo
-- migracion en el repo, asi que 20260828000000_admin_audit_actor.sql —que le
-- hace ALTER— moria en cualquier base nueva con
-- "relation public.admin_audit_log does not exist". Por eso `supabase start`
-- no levantaba nunca en local.
--
-- Esta migracion crea la tabla base, reproduciendo el schema real de prod
-- (leido de information_schema el 2026-09-08) sin las columnas actor/motivo:
-- esas las sigue agregando la migracion siguiente. Todo va con IF NOT EXISTS
-- para que aplicarla sobre prod sea un no-op.

create table if not exists public.admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,
  target_type  text not null,
  target_id    uuid not null,
  target_label text,
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log using btree (created_at desc);

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log using btree (target_type, target_id);

-- RLS prendida y sin policies, igual que en prod: la tabla la escribe solo el
-- back-office via service_role, ningun cliente la lee.
alter table public.admin_audit_log enable row level security;
