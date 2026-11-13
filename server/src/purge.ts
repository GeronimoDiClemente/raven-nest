import type { Pool } from 'pg'

/** §11.6. */
const DEFAULT_RETENTION_DAYS = 90

/**
 * Borra los tombstones más viejos que la ventana de retención y devuelve cuántos borró.
 *
 * Un tombstone existe sólo para que un borrado viaje a las otras máquinas. Pasada la
 * ventana ya no sirve y ocupa lugar. El costo conocido: una máquina apagada más tiempo que
 * la ventana nunca se entera de esos borrados y sus copias locales resucitan. 90 días hace
 * ese caso improbable sin acumular basura para siempre.
 *
 * El `and deleted = true` es lo único verdaderamente crítico de esta consulta: sin él, esta
 * función borra memoria viva por antigüedad, que es exactamente lo que el producto promete
 * no hacer nunca.
 *
 * La antigüedad se mide con `tombstoned_at` — el momento en que la fila SE VOLVIÓ tombstone
 * — no con `server_created_at`, que es de cuando la MEMORIA nació y nunca se actualiza en la
 * transición a borrada (ver el `on conflict` de push.ts). Con `server_created_at` una
 * observación vieja borrada hoy se purgaba mañana: un tombstone de un día de vida, no de 90.
 *
 * Una fila `deleted = true` con `tombstoned_at` nulo no debería existir después de la
 * migración 002 (que backfillea todo tombstone existente) — el `on conflict` de push.ts
 * también lo estampa siempre que una fila pasa a `deleted`. Si igual apareciera una (un bug
 * en otra parte, una migración salteada), NO se purga: `tombstoned_at is null` queda afuera
 * del `<` a propósito, así que esa fila sobrevive indefinidamente en vez de desaparecer sin
 * que nadie la vea envejecer primero. Perder el hábito de purgarla es barato; borrar sin
 * saber desde cuándo es tombstone no lo es.
 */
export async function purgeTombstones(
  pool: Pool,
  olderThanDays: number = DEFAULT_RETENTION_DAYS
): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from observations
      where deleted = true
        and tombstoned_at < now() - ($1 || ' days')::interval`,
    [String(olderThanDays)]
  )
  return rowCount ?? 0
}

/**
 * Los recibos de push y los rechazos más viejos que la misma ventana de 90 días.
 *
 * `push_receipts` guarda una fila por cada mutación subida (cada re-upload vuelve a sumar la
 * base entera) y `rejected_pushes` una por cada rechazo; nada los borraba, y crecían para
 * siempre. Un recibo sirve para que un REINTENTO de la misma mutación no se aplique dos veces:
 * el cliente reintenta en minutos u horas, no en meses. Si una máquina reintenta después de la
 * ventana, la mutación se vuelve a evaluar y el guardia de LWW de `push.ts` la descarta si ya
 * perdió contra lo guardado: el mismo costo que el de los tombstones, y la misma ventana.
 *
 * Los rechazos son observabilidad: lo que sirve es lo reciente.
 */
export async function purgeRegistrosDePush(
  pool: Pool,
  olderThanDays: number = DEFAULT_RETENTION_DAYS
): Promise<{ recibos: number; rechazos: number }> {
  const intervalo = [String(olderThanDays)]
  const recibos = await pool.query(
    `delete from push_receipts where created_at < now() - ($1 || ' days')::interval`,
    intervalo
  )
  const rechazos = await pool.query(
    `delete from rejected_pushes where created_at < now() - ($1 || ' days')::interval`,
    intervalo
  )
  return { recibos: recibos.rowCount ?? 0, rechazos: rechazos.rowCount ?? 0 }
}
