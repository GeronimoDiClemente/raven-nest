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
 */
export async function purgeTombstones(
  pool: Pool,
  olderThanDays: number = DEFAULT_RETENTION_DAYS
): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from observations
      where deleted = true
        and server_created_at < now() - ($1 || ' days')::interval`,
    [String(olderThanDays)]
  )
  return rowCount ?? 0
}
