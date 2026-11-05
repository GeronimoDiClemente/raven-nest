// La TUI entera: encabezado, pestañas, la pantalla actual, la barra de teclas y la ayuda.
//
// El estado no vive en React: lo tiene el `Runner` y la App se suscribe. Quien suelta la
// terminal para el editor puede desmontar Ink y volver a montar la App con el mismo runner.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { columnas, type EstadoDeLaTui } from './estado'
import type { FuenteDeLaTui } from './fuente'
import { ink } from './ink'
import { crearRunner, type Instantanea, type Runner, type SuspenderYEditar } from './runner'
import { hayColor, pintar } from './colores'
import { Lista } from './lista'
import { Detalle } from './detalle'
import { Status } from './status'
import { Doctor } from './doctor'

const PESTANAS = [
  { id: 'recent', nombre: 'Recent' },
  { id: 'search', nombre: 'Search' },
  { id: 'status', nombre: 'Status' },
  { id: 'doctor', nombre: 'Doctor' },
] as const

/** Filas que se llevan el encabezado, las pestañas, los dos separadores y la barra. */
const FILAS_FIJAS = 6
const ALTO_POR_DEFECTO = 24

export const AYUDA: Array<[string, string]> = [
  ['1-4 / Tab', 'switch tab (Shift+Tab goes back)'],
  ['↑↓ / j k', 'move, or scroll a memory'],
  ['⏎', 'open the memory, or follow the focused link'],
  ['Tab', 'in a memory: next link (Shift+Tab: previous)'],
  ['Esc', 'back, or clear the search'],
  ['/', 'search'],
  ['g', 'Recent: this project / all projects'],
  ['n', 'new memory in $EDITOR'],
  ['e', 'edit in $EDITOR'],
  ['d', 'delete (asks first)'],
  ['?', 'this help'],
  ['q / Ctrl+C', 'quit'],
]

/** Las teclas de la pantalla actual, para la barra de abajo. */
export function teclasDe(e: EstadoDeLaTui): string {
  if (e.ayuda) return '? close help  esc close'
  if (e.pila.length > 0) return '↑↓ scroll  tab link  ⏎ follow  e edit  d delete  esc back  q quit'
  switch (e.pestana) {
    case 'recent': return '↑↓ move  ⏎ open  n new  e edit  d delete  g all/this project  / search  ? help  q quit'
    case 'search': return 'type to search  ↑↓ move  ⏎ open  esc clear  tab next tab'
    case 'status':
    case 'doctor': return '1-4 tabs  tab next  n new  / search  ? help  q quit'
  }
}

/** Bajo este ancho el encabezado y las pestañas van compactos, para que sigan en una fila. */
const ANCHO_COMPACTO = 50

function Encabezado(p: { proyecto: string; inst: Instantanea; ancho: number; compacto: boolean; color: boolean }) {
  const { Box, Text } = ink()
  const s = p.inst.status
  const sincronizado = s?.resumen === 'synced'
  const items = s && s.modo !== 'daemon' && !p.compacto
    ? ` · ${s.total.toLocaleString('en-US')} ${s.total === 1 ? 'item' : 'items'}`
    : ''
  return (
    <Box justifyContent="space-between" width={p.ancho}>
      <Text bold wrap="truncate">Nest Memory · {p.proyecto}</Text>
      {s && s.resumen ? (
        <Box flexShrink={0} marginLeft={1}>
          <Text wrap="truncate">
            <Text color={pintar(p.color, sincronizado ? 'green' : 'yellow')}>●</Text>
            {` ${s.resumen}${items}`}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

function Pestanas(p: { estado: EstadoDeLaTui; compacto: boolean }) {
  const { Text } = ink()
  const separacion = p.compacto ? ' ' : '  '
  return (
    <Text wrap="truncate">
      {PESTANAS.map((t, i) => {
        const activa = t.id === p.estado.pestana && p.estado.pila.length === 0
        const nombre = `${i + 1} ${t.nombre}${t.id === 'recent' && p.estado.todosLosProyectos ? ' · all' : ''}`
        const relleno = p.compacto ? '' : ' '
        return <Text key={t.id} bold={activa}>{activa ? `[${nombre}]` : `${relleno}${nombre}${relleno}`}{separacion}</Text>
      })}
    </Text>
  )
}

function Barra(p: { estado: EstadoDeLaTui; color: boolean }) {
  const { Text } = ink()
  const e = p.estado
  if (e.confirmando) return <Text color={pintar(p.color, 'red')} wrap="truncate">Delete "{e.confirmando.titulo}"? y/N</Text>
  if (e.editando) return <Text dimColor wrap="truncate">Saving…</Text>
  if (e.errorDeEditor) {
    return (
      <Text wrap="truncate">
        <Text color={pintar(p.color, 'red')}>{e.errorDeEditor.mensaje}</Text>
        <Text dimColor>  r reopen  d discard</Text>
      </Text>
    )
  }
  if (e.aviso) return <Text color={pintar(p.color, e.aviso.tipo === 'error' ? 'red' : 'green')} wrap="truncate">{e.aviso.texto}</Text>
  return <Text dimColor wrap="truncate">{teclasDe(e)}</Text>
}

function Ayuda() {
  const { Box, Text } = ink()
  return (
    <Box flexDirection="column">
      <Text bold>Keys</Text>
      {AYUDA.map(([tecla, que]) => (
        <Text key={tecla}><Text bold>{tecla.padEnd(12)}</Text>{que}</Text>
      ))}
    </Box>
  )
}

function Pantalla(p: { inst: Instantanea; ancho: number; alto: number; color: boolean; proyecto: string }) {
  const { estado: e } = p.inst
  const ahora = Date.now()
  if (e.ayuda) return <Ayuda />
  if (e.pila.length > 0) {
    // De qué proyecto es la memoria no viaja en el summary: sólo se dice cuando Recent está
    // filtrada por el proyecto actual, que es lo único que sabemos seguro.
    const proyecto = e.pestana === 'recent' && !e.todosLosProyectos ? p.proyecto : null
    return <Detalle estado={e} ancho={p.ancho - 2} alto={p.alto} color={p.color} ahora={ahora} proyecto={proyecto} />
  }
  switch (e.pestana) {
    case 'recent':
    case 'search': return <Lista estado={e} ancho={p.ancho - 2} conFecha={columnas(p.ancho).conFecha} alto={p.alto} color={p.color} ahora={ahora} />
    case 'status': return <Status datos={p.inst.status} color={p.color} />
    case 'doctor': return <Doctor datos={p.inst.doctor} color={p.color} />
  }
}

export function App(p: {
  fuente: FuenteDeLaTui
  ancho: number
  suspenderYEditar: SuspenderYEditar
  /** Para volver a montar con el estado de antes; sin él, la App arma uno propio. */
  runner?: Runner
}): JSX.Element {
  const { Box, Text, useInput, useApp, useStdout } = ink()
  const [runner] = useState(() => p.runner ?? crearRunner({ fuente: p.fuente, suspenderYEditar: p.suspenderYEditar }))
  const inst = useSyncExternalStore(runner.suscribir, runner.instantanea)
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [ancho, setAncho] = useState(p.ancho)
  const [alto, setAlto] = useState(stdout.rows || ALTO_POR_DEFECTO)
  const [proyecto] = useState(() => p.fuente.proyecto())
  const color = hayColor()

  useEffect(() => {
    runner.iniciar()
    // Un runner propio muere con la App; uno prestado sigue (el editor lo va a usar).
    return () => { if (!p.runner) runner.detener() }
  }, [runner])

  useEffect(() => { if (inst.saliendo) exit() }, [inst.saliendo])

  useEffect(() => {
    const alCambiar = () => {
      setAncho(stdout.columns || p.ancho)
      setAlto(stdout.rows || ALTO_POR_DEFECTO)
    }
    stdout.on('resize', alCambiar)
    return () => { stdout.off('resize', alCambiar) }
  }, [stdout])

  useInput((input, key) => runner.despachar({ tipo: 'tecla', input, key }))

  if (columnas(ancho).demasiadoAngosta) return <Text>Window too narrow</Text>

  const linea = '─'.repeat(Math.max(0, ancho - 2))
  return (
    <Box flexDirection="column" width={ancho} paddingX={1}>
      <Encabezado proyecto={proyecto} inst={inst} ancho={ancho - 2} compacto={ancho < ANCHO_COMPACTO} color={color} />
      <Pestanas estado={inst.estado} compacto={ancho < ANCHO_COMPACTO} />
      <Text dimColor>{linea}</Text>
      <Box flexDirection="column" height={Math.max(1, alto - FILAS_FIJAS)}>
        <Pantalla inst={inst} ancho={ancho} alto={Math.max(1, alto - FILAS_FIJAS)} color={color} proyecto={proyecto} />
      </Box>
      <Text dimColor>{linea}</Text>
      <Barra estado={inst.estado} color={color} />
    </Box>
  )
}
