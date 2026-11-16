-- §11.3. La retención de 30 días NO vive acá: la hace la regla de ciclo de vida del bucket
-- de R2. Esta tabla es sólo el rastro de qué pasó, para que "¿cuándo fue el último backup
-- bueno?" tenga una respuesta que no dependa de ir a mirar el bucket.
--
-- La fila se inserta cuando el intento EMPIEZA, no cuando termina. Un proceso que muere a la
-- mitad del dump deja entonces una fila con ok=false y finished_at nulo, que es exactamente
-- lo que hay que poder ver. Si la fila se insertara al final, ese intento no habría existido
-- nunca para nadie, y un backup que falla callado es el peor caso de todos.
create table if not exists backups (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean not null default false,
  object_key    text,
  bytes         bigint,
  sha256        text,
  -- Cuántas filas tenía cada tabla cuando se tomó ESTE dump. Es lo que le permite a
  -- `restore-check.mjs` verificar una restauración sin compararse contra la base viva, que
  -- para cuando el script corre ya se movió.
  row_counts    jsonb,
  error         text
);

-- La consulta que más se va a correr es "el último backup bueno" y "los últimos N intentos".
create index if not exists backups_recent on backups (started_at desc);
