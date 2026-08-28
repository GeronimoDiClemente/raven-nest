-- El contrato del back-office exige registrar quién hizo cada acción y por qué.
-- `admin_audit_log` se creó a mano en la base (no tiene migración previa en el
-- repo), así que esto es tolerante a que las columnas ya existan.

alter table public.admin_audit_log
  add column if not exists actor       text,
  add column if not exists actor_email text,
  add column if not exists motivo      text,
  -- Un intento fallido también se audita: saber que alguien quiso borrar una
  -- cuenta y no pudo es información operativa.
  add column if not exists ok          boolean not null default true,
  add column if not exists error       text;

comment on column public.admin_audit_log.actor is
  'X-Admin-Actor: id del staff del back-office. No existe en auth.users de Nest.';
comment on column public.admin_audit_log.motivo is
  'X-Admin-Motivo: obligatorio en toda escritura del contrato.';

create index if not exists admin_audit_log_creado
  on public.admin_audit_log (created_at desc);
