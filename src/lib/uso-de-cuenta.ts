// Spec 2b-3 §3.2: las líneas de Usage de Settings › Account. Puro: lo dibuja AccountPlanSection.
import { descripcionDeProyectosEnLaNube, soloLocales, tieneTope, type ProyectoEnLaNube } from './proyectos-en-la-nube'

export type EstadoDeUso =
  | { tipo: 'apagado' }                // 'Cloud sync is off.' + 'Turn on in Memory settings ›'
  | { tipo: 'cargando' }               // conectando o importando: ni "off" ni números todavía
  | { tipo: 'beta' }                   // 'Cloud sync is invite-only during the beta.'
  | { tipo: 'conectado'; proyectos: string | null; soloLocales: number }

export function estadoDeUso(m: {
  state: string
  error: string | null
  cloudProjects: ProyectoEnLaNube[] | null
  maxProjects: number | null
  localOnly: ProyectoEnLaNube[]
  overLimit: boolean
}): EstadoDeUso {
  if (m.state === 'error' && m.error === 'not_in_beta') return { tipo: 'beta' }
  // Mientras conecta no se dice "Cloud sync is off.": parpadearía justo antes de conectar.
  // (El 'disconnected' inicial de useMemory, antes del primer status, no se distingue de uno
  // real: el hook no expone una señal de "ya leí".)
  if (m.state === 'connecting' || m.state === 'migrating') return { tipo: 'cargando' }
  // `paused` (sin red, candado tomado) sigue siendo una cuenta conectada: el uso vale igual.
  if (m.state !== 'connected' && m.state !== 'paused') return { tipo: 'apagado' }
  const enLaNube = m.cloudProjects ?? []
  let k = soloLocales(m.localOnly, enLaNube).length
  // Sobre el tope (2b-2 §4.7) los que pasan del tope están en la nube pero ya no suben:
  // lo nuevo de esos se queda en esta máquina, igual que un local only.
  if (m.overLimit && tieneTope(m.maxProjects)) k += Math.max(0, enLaNube.length - m.maxProjects)
  return {
    tipo: 'conectado',
    proyectos: m.cloudProjects ? descripcionDeProyectosEnLaNube(m.cloudProjects, m.maxProjects) : null,
    soloLocales: k,
  }
}
