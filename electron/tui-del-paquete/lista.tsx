// Recent y Search: la misma lista de memorias. Search suma la línea de la consulta arriba.
import type { EstadoDeLaTui } from './estado'
import { ink } from './ink'
import { colorDeTipo, etiquetaDeTipo, pintar, proveedor } from './colores'
import { hace, recortar } from '../estilo-del-paquete'
import { TIPOS } from '../memory-protocol'
import { LIMITE } from './runner'

/** El tipo más largo (`architecture`) entra entero. */
const ANCHO_DE_TIPO = Math.max(...TIPOS.map((t) => t.length))
const ANCHO_DE_FECHA = 8
/** `◆ DeepSeek`, el más largo. */
const ANCHO_DE_PROVEEDOR = 10
/** Bajo este ancho interior el proveedor se cae antes que el título: el título es la fila. */
const ANCHO_CON_PROVEEDOR = 76

export const BIENVENIDA = 'No memories yet. Agents save them through the MCP, or press n.'

/** «2h ago», o «now». */
export function haceCuanto(ms: number, ahora: number): string {
  const h = hace(ms, ahora)
  return h === 'now' ? h : `${h} ago`
}

/** «3 of 12 · this project»: dónde está el cursor y qué se está mirando. */
export function posicionEnLista(e: Pick<EstadoDeLaTui, 'lista' | 'cursor' | 'pestana' | 'todosLosProyectos'>): string {
  const n = e.lista.length
  const total = `${n}${n >= LIMITE ? '+' : ''}`
  const alcance = e.pestana === 'recent' ? (e.todosLosProyectos ? ' · all projects' : ' · this project') : ''
  return `${e.cursor + 1} of ${total}${alcance}`
}

/** La ventana de filas que entra en `alto`, siguiendo al cursor. */
function ventana(total: number, cursor: number, alto: number): [number, number] {
  if (total <= alto) return [0, total]
  const desde = Math.min(Math.max(0, cursor - alto + 1), total - alto)
  return [desde, desde + alto]
}

/** `◆ Claude` con el color de su logo, o vacío si no se sabe quién la escribió. */
export function Proveedor(p: { ai: string | null; color: boolean; ancho?: number }) {
  const { Text } = ink()
  if (!p.ai) return <Text>{' '.repeat((p.ancho ?? 0) + 1)}</Text>
  const { nombre, color } = proveedor(p.ai)
  const texto = recortar(nombre, Math.max(1, (p.ancho ?? nombre.length + 2) - 2))
  return (
    <Text>
      {' '}<Text color={color && p.color ? color : undefined}>◆</Text>
      <Text dimColor>{` ${texto}`.padEnd((p.ancho ?? texto.length + 2) - 1)}</Text>
    </Text>
  )
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
    // 2 del cursor, el tipo y su espacio, el proveedor y la fecha si entran.
    const conProveedor = p.ancho >= ANCHO_CON_PROVEEDOR && e.lista.some((m) => m.originAi)
    const anchoDeTitulo = Math.max(8, p.ancho - 2 - (ANCHO_DE_TIPO + 1)
      - (conProveedor ? ANCHO_DE_PROVEEDOR + 1 : 0) - (conFecha ? ANCHO_DE_FECHA + 1 : 0))
    // La consulta se lleva 2 filas, y la posición de abajo otra.
    const [desde, hasta] = ventana(e.lista.length, e.cursor, Math.max(1, p.alto - (enSearch ? 2 : 0) - 1))
    cuerpo = (
      <Box flexDirection="column">
        {e.lista.slice(desde, hasta).map((m, i) => {
          const elegida = desde + i === e.cursor
          return (
            <Box key={m.syncId}>
              <Text bold>{elegida ? '▌ ' : '  '}</Text>
              <Text color={pintar(color, colorDeTipo(m.type))}>{etiquetaDeTipo(m.type).padEnd(ANCHO_DE_TIPO)} </Text>
              <Text bold={elegida}>{recortar(m.title, anchoDeTitulo).padEnd(anchoDeTitulo)}</Text>
              {conProveedor ? <Proveedor ai={m.originAi} color={color} ancho={ANCHO_DE_PROVEEDOR} /> : null}
              {conFecha ? <Text dimColor> {haceCuanto(m.updatedAt, p.ahora).padStart(ANCHO_DE_FECHA)}</Text> : null}
            </Box>
          )
        })}
        <Text dimColor>{posicionEnLista(e)}</Text>
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
