// El detalle de una memoria: encabezado y contenido con scroll, con los [[wikilinks]] resaltados.
import { segmentosDeContenido, type EstadoDeLaTui } from './estado'
import { ink } from './ink'
import { colorDeTipo, etiquetaDeTipo, pintar } from './colores'
import { haceCuanto, Proveedor } from './lista'

type Segmento = ReturnType<typeof segmentosDeContenido>[number]

/**
 * Los segmentos, partidos en líneas. Se segmenta el texto ENTERO y después se corta: así un
 * bloque de código de varias líneas sigue enmascarado como en `parsearWikilinks`.
 */
export function lineasDeContenido(texto: string, links: Parameters<typeof segmentosDeContenido>[1]): Segmento[][] {
  const lineas: Segmento[][] = [[]]
  for (const s of segmentosDeContenido(texto, links)) {
    const partes = s.texto.split('\n')
    partes.forEach((parte, i) => {
      if (i > 0) lineas.push([])
      if (parte) lineas[lineas.length - 1]!.push({ ...s, texto: parte })
    })
  }
  return lineas
}

/**
 * Dónde se corta una línea de `largo` caracteres para que ninguna fila pase de `ancho`: en el
 * último espacio que entra (que se come) o, si una palabra no entra, en seco. Devuelve los
 * tramos `[desde, hasta)` del texto.
 */
export function cortesDeLinea(texto: string, ancho: number): Array<[number, number]> {
  const tramos: Array<[number, number]> = []
  let pos = 0
  while (texto.length - pos > ancho) {
    const espacio = texto.slice(pos, pos + ancho + 1).lastIndexOf(' ')
    if (espacio > 0) {
      tramos.push([pos, pos + espacio])
      pos += espacio + 1
    } else {
      tramos.push([pos, pos + ancho])
      pos += ancho
    }
  }
  tramos.push([pos, texto.length])
  return tramos
}

/**
 * Las líneas lógicas, partidas en filas de pantalla. Ink envuelve solo lo que no entra, pero
 * entonces una línea ocupa varias filas que el scroll no cuenta: el contenido se sale de su
 * caja y el final queda inalcanzable. Cortando acá, cada elemento es exactamente una fila.
 * Los tramos de un link partido conservan su `link`.
 */
export function filasDeContenido(lineas: Segmento[][], ancho: number): Segmento[][] {
  const filas: Segmento[][] = []
  const w = Math.max(1, ancho)
  for (const linea of lineas) {
    const texto = linea.map((s) => s.texto).join('')
    for (const [desde, hasta] of cortesDeLinea(texto, w)) {
      const fila: Segmento[] = []
      let ini = 0
      for (const s of linea) {
        const fin = ini + s.texto.length
        const a = Math.max(desde, ini)
        const b = Math.min(hasta, fin)
        if (a < b) fila.push({ ...s, texto: s.texto.slice(a - ini, b - ini) })
        ini = fin
      }
      filas.push(fila)
    }
  }
  return filas
}

/** Cuántos backlinks se ven a la vez: más, y el contenido se queda sin lugar. */
const BACKLINKS_A_LA_VISTA = 5

/** Qué tramo de los backlinks se ve: los primeros, o los que rodean al enfocado. */
export function ventanaDeBacklinks(total: number, enfocado: number | null): [number, number] {
  if (total <= BACKLINKS_A_LA_VISTA) return [0, total]
  const desde = enfocado === null ? 0 : Math.min(Math.max(0, enfocado - BACKLINKS_A_LA_VISTA + 1), total - BACKLINKS_A_LA_VISTA)
  return [desde, desde + BACKLINKS_A_LA_VISTA]
}

/** `ancho` es el interior (sin márgenes). */
export function Detalle(p: { estado: EstadoDeLaTui; ancho: number; alto: number; color: boolean; ahora: number; proyecto: string | null }) {
  const { Box, Text } = ink()
  const { estado: e, color } = p
  const tope = e.pila[e.pila.length - 1]!
  const d = e.detalle
  if (!d) return <Text dimColor>Loading…</Text>

  const { item } = d
  const tipo = etiquetaDeTipo(item.type)
  const meta = [
    tipo,
    item.tags.length > 0 ? item.tags.map((t) => `#${t}`).join(' ') : null,
    p.proyecto,
    item.gitBranch,
    haceCuanto(item.updatedAt, p.ahora),
  ].filter(Boolean).join(' · ')

  // Las propiedades del panel lateral de la app; sin ellas (un Nest viejo) no hay fila.
  const propiedades = d.scope !== undefined || d.revisiones !== undefined
  const backlinks = d.mencionadaEn ?? []
  const base = d.resolvedLinks.length
  const enfocadoEnBacklinks = tope.linkEnfocado !== null && tope.linkEnfocado >= base ? tope.linkEnfocado - base : null
  const [bDesde, bHasta] = ventanaDeBacklinks(backlinks.length, enfocadoEnBacklinks)
  const quedanFuera = backlinks.length - (bHasta - bDesde)
  // El espacio, el título de la sección, las filas y el «+N more».
  const altoDeBacklinks = backlinks.length === 0 ? 0 : 2 + (bHasta - bDesde) + (quedanFuera > 0 ? 1 : 0)

  const lineas = filasDeContenido(lineasDeContenido(item.content, d.resolvedLinks), p.ancho)
  // Título, meta, propiedades y el espacio: lo que queda (menos los backlinks) es para el
  // contenido. Las de arriba se truncan para que ocupen una fila cada una.
  const altoDeContenido = Math.max(1, p.alto - 3 - (propiedades ? 1 : 0) - altoDeBacklinks)
  // El reducer no sabe cuántas líneas hay: el tope del scroll se aplica al dibujar.
  const desde = Math.min(tope.scroll, Math.max(0, lineas.length - altoDeContenido))
  const visibles = lineas.slice(desde, desde + altoDeContenido)

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate">{item.title}</Text>
      <Text wrap="truncate">
        <Text color={pintar(color, colorDeTipo(item.type))}>{meta.slice(0, tipo.length)}</Text>
        <Text dimColor>{meta.slice(tipo.length)}</Text>
        {item.originAi ? <><Text dimColor> ·</Text><Proveedor ai={item.originAi} color={color} /></> : null}
      </Text>
      {propiedades ? (
        <Text wrap="truncate">
          {d.scope ? <><Text dimColor>Scope </Text>{d.scope}</> : null}
          {d.scope && d.revisiones !== undefined ? '   ' : null}
          {d.revisiones !== undefined ? <><Text dimColor>Revisions </Text>{d.revisiones}</> : null}
        </Text>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {visibles.map((linea, i) => (
          <Text key={desde + i} wrap="truncate">
            {linea.length === 0 ? ' ' : linea.map((s, j) => {
              if (!s.link) return <Text key={j}>{s.texto}</Text>
              // Un hueco (sin destino) va apagado y no se enfoca; el enfocado, invertido.
              if (!s.link.syncId) return <Text key={j} dimColor>{s.texto}</Text>
              return <Text key={j} underline inverse={s.link.indice === tope.linkEnfocado}>{s.texto}</Text>
            })}
          </Text>
        ))}
      </Box>
      {backlinks.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>MENTIONED IN</Text>
          {backlinks.slice(bDesde, bHasta).map((b, i) => (
            <Text key={b.syncId} wrap="truncate">
              <Text dimColor>← </Text>
              <Text underline inverse={bDesde + i === enfocadoEnBacklinks}>{b.title}</Text>
            </Text>
          ))}
          {quedanFuera > 0 ? <Text dimColor>{`+${quedanFuera} more — tab to reach them`}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}
