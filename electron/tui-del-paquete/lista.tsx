// Recent y Search: la misma lista de memorias. Search suma la línea de la consulta arriba.
import type { EstadoDeLaTui } from './estado'
import { ink } from './ink'
import { COLOR_DE_GRUPO, pintar } from './colores'
import { grupoDeTipo, hace, recortar } from '../estilo-del-paquete'
import { TIPOS } from '../memory-protocol'

/** El tipo más largo (`architecture`) entra entero. */
const ANCHO_DE_TIPO = Math.max(...TIPOS.map((t) => t.length))
const ANCHO_DE_FECHA = 8

export const BIENVENIDA = 'No memories yet. Agents save them through the MCP, or press n.'

/** «2h ago», o «now». */
export function haceCuanto(ms: number, ahora: number): string {
  const h = hace(ms, ahora)
  return h === 'now' ? h : `${h} ago`
}

/** La ventana de filas que entra en `alto`, siguiendo al cursor. */
function ventana(total: number, cursor: number, alto: number): [number, number] {
  if (total <= alto) return [0, total]
  const desde = Math.min(Math.max(0, cursor - alto + 1), total - alto)
  return [desde, desde + alto]
}

/** `ancho` es el interior (sin márgenes); `conFecha` lo decide `columnas` con el ancho de la terminal. */
export function Lista(p: { estado: EstadoDeLaTui; ancho: number; conFecha: boolean; alto: number; color: boolean; ahora: number }) {
  const { Box, Text } = ink()
  const { estado: e, color } = p
  const enSearch = e.pestana === 'search'
  const { conFecha } = p

  const consulta = enSearch ? (
    <Box marginBottom={1}>
      <Text dimColor>Search: </Text>
      <Text>{e.consulta}</Text>
      <Text inverse> </Text>
    </Box>
  ) : null

  let cuerpo: JSX.Element
  if (e.lista.length === 0) {
    const texto = e.cargando ? (enSearch ? 'Searching…' : 'Loading…')
      : !enSearch ? BIENVENIDA
      : e.consulta ? `No matches for "${e.consulta}"`
      : 'Type to search your memories'
    cuerpo = <Text dimColor={e.cargando || enSearch}>{texto}</Text>
  } else {
    // 2 del cursor, el tipo y su espacio, y la fecha si entra.
    const anchoDeTitulo = Math.max(8, p.ancho - 2 - (ANCHO_DE_TIPO + 1) - (conFecha ? ANCHO_DE_FECHA + 1 : 0))
    const [desde, hasta] = ventana(e.lista.length, e.cursor, Math.max(1, p.alto - (enSearch ? 2 : 0)))
    cuerpo = (
      <Box flexDirection="column">
        {e.lista.slice(desde, hasta).map((m, i) => {
          const elegida = desde + i === e.cursor
          return (
            <Box key={m.syncId}>
              <Text>{elegida ? '▸ ' : '  '}</Text>
              <Text color={pintar(color, COLOR_DE_GRUPO[grupoDeTipo(m.type)])}>{m.type.padEnd(ANCHO_DE_TIPO)} </Text>
              <Text bold={elegida}>{recortar(m.title, anchoDeTitulo).padEnd(anchoDeTitulo)}</Text>
              {conFecha ? <Text dimColor> {haceCuanto(m.updatedAt, p.ahora).padStart(ANCHO_DE_FECHA)}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {consulta}
      {cuerpo}
    </Box>
  )
}
