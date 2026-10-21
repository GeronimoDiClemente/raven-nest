/**
 * Un uuid en texto. Las columnas uuid de la base (`team_id`, `users.id`…) reciben algo que no
 * lo es como un 22P02 de Postgres, que sale como 500 `internal_error`: se valida antes con
 * esto y se contesta 400. Un solo lugar para la regex (http.ts, share.ts, plan-sync.ts).
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
