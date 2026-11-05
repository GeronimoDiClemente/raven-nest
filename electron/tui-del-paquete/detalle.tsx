// El detalle de una memoria: encabezado y contenido con scroll, con los [[wikilinks]] resaltados.
import { segmentosDeContenido, type EstadoDeLaTui } from './estado'
import { ink } from './ink'
import { COLOR_DE_GRUPO, pintar } from './colores'
import { haceCuanto } from './lista'
import { grupoDeTipo } from '../estilo-del-paquete'

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

export function Detalle(p: { estado: EstadoDeLaTui; alto: number; color: boolean; ahora: number; proyecto: string | null }) {
  const { Box, Text } = ink()
  const { estado: e, color } = p
  const tope = e.pila[e.pila.length - 1]!
  const d = e.detalle
  if (!d) return <Text dimColor>Loading…</Text>

  const { item } = d
  const meta = [
    item.type,
    item.tags.length > 0 ? item.tags.map((t) => `#${t}`).join(' ') : null,
    p.proyecto,
    haceCuanto(item.updatedAt, p.ahora),
  ].filter(Boolean).join(' · ')

  const lineas = lineasDeContenido(item.content, d.resolvedLinks)
  // Título, meta y el espacio: lo que queda es para el contenido.
  const altoDeContenido = Math.max(1, p.alto - 3)
  // El reducer no sabe cuántas líneas hay: el tope del scroll se aplica al dibujar.
  const desde = Math.min(tope.scroll, Math.max(0, lineas.length - altoDeContenido))
  const visibles = lineas.slice(desde, desde + altoDeContenido)

  return (
    <Box flexDirection="column">
      <Text bold>{item.title}</Text>
      <Text>
        <Text color={pintar(color, COLOR_DE_GRUPO[grupoDeTipo(item.type)])}>{meta.slice(0, item.type.length)}</Text>
        <Text dimColor>{meta.slice(item.type.length)}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visibles.map((linea, i) => (
          <Text key={desde + i}>
            {linea.length === 0 ? ' ' : linea.map((s, j) => {
              if (!s.link) return <Text key={j}>{s.texto}</Text>
              // Un hueco (sin destino) va apagado y no se enfoca; el enfocado, invertido.
              if (!s.link.syncId) return <Text key={j} dimColor>{s.texto}</Text>
              return <Text key={j} underline inverse={s.link.indice === tope.linkEnfocado}>{s.texto}</Text>
            })}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
