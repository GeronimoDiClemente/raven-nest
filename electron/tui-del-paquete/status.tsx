// La pestaña Status: el mismo contenido que `nestmux-memory status`, de `DatosDeStatus`.
import { ink } from './ink'
import { MARCA, ORDEN_DE_TIPOS, colorDeTipo, etiquetaDeTipo, pintar } from './colores'
import type { DatosDeStatus, FilaDeEstado } from '../status-del-paquete'

/** `✓  Etiqueta      detalle`, con la etiqueta en columna fija como en el CLI. */
export function FilaDeMarca(p: { fila: FilaDeEstado; color: boolean; ancho?: number }) {
  const { Text } = ink()
  const m = MARCA[p.fila.marca]
  return (
    <Text>
      <Text color={pintar(p.color, m.color)}>{m.simbolo}</Text>
      {`  ${p.fila.etiqueta.padEnd(p.ancho ?? 13)} ${p.fila.detalle}`}
    </Text>
  )
}

/** El ancho máximo de la barra: más larga no se lee mejor, sólo ocupa. */
const ANCHO_DE_BARRA = 48

/**
 * Cuántos bloques le tocan a cada tipo, en el orden de la leyenda de la app. Un tipo presente
 * nunca baja de un bloque: si no, el que tiene 2 de 1.284 desaparece de la barra.
 */
export function bloquesDeTipos(porTipo: Record<string, number>, ancho: number): Array<[string, number]> {
  const conocidos = ORDEN_DE_TIPOS.filter((t) => (porTipo[t] ?? 0) > 0)
  const otros = Object.keys(porTipo).filter((t) => !conocidos.includes(t as never) && porTipo[t]! > 0).sort()
  const tipos = [...conocidos, ...otros]
  const total = tipos.reduce((n, t) => n + porTipo[t]!, 0)
  if (total === 0) return []
  const libre = Math.max(tipos.length, ancho)
  return tipos.map((t) => [t, Math.max(1, Math.round((porTipo[t]! / total) * libre))])
}

export function Status(p: { datos: DatosDeStatus | null; color: boolean; ancho?: number }) {
  const { Box, Text } = ink()
  const { datos: d, color } = p
  if (!d) return <Text dimColor>Loading…</Text>

  const filas = (
    <Box flexDirection="column">
      {d.filas.map((f) => <FilaDeMarca key={f.etiqueta} fila={f} color={color} />)}
    </Box>
  )
  if (d.sinConteos) return filas
  if (d.vacia) {
    return (
      <Box flexDirection="column">
        <Text>No memory on this machine yet. It will live at <Text dimColor>{d.guardadaEn ?? ''}</Text></Text>
        <Text><Text dimColor>Start with:</Text> nestmux-memory setup</Text>
      </Box>
    )
  }

  const bloques = bloquesDeTipos(d.porTipo, Math.min(ANCHO_DE_BARRA, (p.ancho ?? 80) - 2))
  return (
    <Box flexDirection="column">
      <Text><Text bold>{d.total.toLocaleString('en-US')}</Text> {d.total === 1 ? 'memory' : 'memories'}</Text>
      {bloques.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {/* Sin color la barra no distingue nada: queda sólo la leyenda. */}
          {color ? (
            <Text>{bloques.map(([t, n]) => <Text key={t} color={colorDeTipo(t)}>{'█'.repeat(n)}</Text>)}</Text>
          ) : null}
          <Text>
            {bloques.map(([t], i) => (
              <Text key={t}>
                {i > 0 ? '   ' : ''}
                <Text color={pintar(color, colorDeTipo(t))}>■</Text> {etiquetaDeTipo(t)} <Text dimColor>{d.porTipo[t]}</Text>
              </Text>
            ))}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        <Text><Text dimColor>{'SCOPE'.padEnd(9)}</Text>personal {d.personal}{d.deEquipo > 0 ? ` · team ${d.deEquipo}` : ''}</Text>
        {d.guardadaEn ? <Text><Text dimColor>{'STORED'.padEnd(9)}</Text>{d.guardadaEn}</Text> : null}
        {d.servicio ? <Text><Text dimColor>{'SERVICE'.padEnd(9)}</Text>{d.servicio}</Text> : null}
      </Box>
      <Box marginTop={1}>{filas}</Box>
    </Box>
  )
}
