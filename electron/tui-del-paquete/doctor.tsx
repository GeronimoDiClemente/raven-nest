// La pestaña Doctor: el contenido de `nestmux-memory doctor`, con lo bloqueado y su razón.
import { ink } from './ink'
import { pintar } from './colores'
import { FilaDeMarca } from './status'
import { resumenDelDoctor, type DatosDeDoctor } from '../doctor-del-paquete'
import { recortar } from '../estilo-del-paquete'

export function Doctor(p: { datos: DatosDeDoctor | null; color: boolean }) {
  const { Box, Text } = ink()
  const { datos: d, color } = p
  if (!d) return <Text dimColor>Loading…</Text>
  const resumen = resumenDelDoctor(d)

  return (
    <Box flexDirection="column">
      {d.filas.map((f) => <FilaDeMarca key={f.etiqueta} fila={f} color={color} />)}
      {d.homeDeNest ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={pintar(color, 'yellow')}>This HOME looks like a Nest account folder.</Text>
          <Text>Nest redirects HOME inside its panes, so the memory you are looking for probably lives under your real home.</Text>
        </Box>
      ) : null}
      {d.bloqueadas.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>BLOCKED</Text>
          {d.bloqueadas.map((b, i) => (
            <FilaDeMarca key={b.syncId ?? i} fila={{ marca: 'aviso', etiqueta: recortar(b.titulo, 40), detalle: b.motivo }} color={color} ancho={40} />
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        {resumen ? <Text bold>{resumen}.</Text> : <Text color={pintar(color, 'green')} bold>All good.</Text>}
      </Box>
    </Box>
  )
}
