-- Observabilidad de sync (Parte 11.5 del plan): log estructurado de rechazos + contadores
-- de push/pull por device, para poder listar "que devices tienen mutaciones rechazadas".
--
-- HALLAZGO CRITICO que hay que respetar al implementar (verificado leyendo src/push.ts:440-670
-- antes de este workflow): cuando una mutacion se rechaza como terminal, el codigo hace
-- `await client.query('begin')` al principio del intento (push.ts:440), inserta un claim
-- 'pending' en push_receipts DENTRO de esa misma transaccion (push.ts:456-461), y si la
-- mutacion falla con un error terminal, el catch de la linea 654 hace
-- `await client.query('rollback')` (linea 655) ANTES de loguear nada — ese rollback deshace
-- TODO, incluido el claim de push_receipts. Esto significa: agregar una columna 'error' a
-- push_receipts y poblarla DENTRO de esa transaccion seria un no-op silencioso, porque esa
-- fila nunca sobrevive al commit. Cualquier logging de rechazos tiene que escribirse en un
-- INSERT SEPARADO, DESPUES de que el rollback ya corrio (mismo `client`, que vuelve a
-- autocommit implicito en cuanto no hay una transaccion abierta) — nunca dentro de la
-- transaccion que se va a deshacer. Por eso esta tabla vive separada de push_receipts.
create table if not exists rejected_pushes (
  id          bigserial primary key,
  device_id   uuid not null references devices(id) on delete cascade,
  sync_id     text not null,
  error       text not null,
  created_at  timestamptz not null default now()
);

-- Sirve la consulta futura: "devices con mutaciones rechazadas", ordenado por lo mas reciente.
create index if not exists rejected_pushes_by_device on rejected_pushes (device_id, created_at desc);

-- Contadores por LLAMADA (no por mutacion individual dentro de un push) a los dos endpoints
-- principales de sync, para poder ver actividad por device sin tener que contar filas.
alter table devices add column if not exists push_count bigint not null default 0;
alter table devices add column if not exists pull_count bigint not null default 0;
