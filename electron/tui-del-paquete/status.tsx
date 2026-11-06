// La pestaña Status: el mismo contenido que `nestmux-memory status`, de `DatosDeStatus`.
import { ink } from './ink'
import { COLOR_DE_GRUPO, MARCA, pintar } from './colores'
import type { DatosDeStatus, FilaDeEstado } from '../status-del-paquete'
import type { GrupoDeTipo } from '../estilo-del-paquete'

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

const ORDEN: GrupoDeTipo[] = ['decisions', 'fixes', 'conventions', 'discoveries', 'sessions']

export function Status(p: { datos: DatosDeStatus | null; color: boolean }) {
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

  const grupos = ORDEN.filter((g) => (d.porGrupo[g] ?? 0) > 0)
  return (
    <Box flexDirection="column">
      <Text><Text bold>{d.total.toLocaleString('en-US')}</Text> {d.total === 1 ? 'memory' : 'memories'}</Text>
      {grupos.length > 0 ? (
        <Text>
          {grupos.map((g, i) => (
            <Text key={g}>
              {i > 0 ? '   ' : ''}
              <Text color={pintar(color, COLOR_DE_GRUPO[g])}>■</Text> {g} {d.porGrupo[g]}
            </Text>
          ))}
        </Text>
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
