-- F3 (review final del cifrado obligatorio, 2026-11-02): un tombstone no guarda texto.
-- Hasta ahora el delete de push.ts anulaba sólo `content` y dejaba título, tags, hash, cuenta
-- de origen (el mail de quien guardó), rama y tema. En las filas de antes del cifrado
-- obligatorio eso es texto legible, y `plaintext_pending` (status.ts, `not deleted`) no lo
-- cuenta, así que ningún re-upload lo iba a pisar nunca. push.ts ya vacía todo al borrar;
-- esto hace lo mismo con los tombstones que ya estaban.
--
-- `title` es NOT NULL (001_init.sql): '' y no null. Idempotente: una segunda pasada no
-- encuentra nada que cambiar.
update observations
   set title = '', content = null, tags = '[]'::jsonb, topic_key = null,
       content_hash = null, origin_account = null, git_branch = null
 where deleted = true
   and (title <> '' or content is not null or coalesce(tags, '[]'::jsonb) <> '[]'::jsonb
        or topic_key is not null or content_hash is not null
        or origin_account is not null or git_branch is not null);
