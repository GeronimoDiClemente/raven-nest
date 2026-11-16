// La detección de huérfanos de tareas de fondo con salidas de `ps` y `lsof` escritas a mano.
import { describe, it, expect } from 'vitest'
import {
  parsearPs, parsearLsof, detectarHuerfanos, segundosDeEtime, candidatos, grupoDe,
} from '../huerfanos-de-tareas'

const UID = 501
const HOME = '/Users/gero'
const TAREA = (id: string) => `/private/tmp/claude-501/-Users-gero-Proyectos-technisis/0a1b-sesion/tasks/${id}.output`

// 63959: el caso del 01/11 — python suelto, su zsh -c (63950) ya murió.
// 70001/70000: una tarea viva — el zsh -c sigue, su hijo también.
// 80000: el líder mismo quedó con PPID 1 (el claude que lo lanzó murió).
// 90000: un agente de launchd del usuario, sin nada que ver.
// 95000: de otro usuario, con la ruta de tarea: no es nuestro.
const PS = `
63959     1 63950   501  99.1 3-02:10:05 /usr/bin/python3 -
70000 97615 70000   501   0.0      01:00 /bin/zsh -c npm run dev
70001     1 70000   501   2.0      00:59 node server.js
80000     1 80000   501   0.5      10:00 /bin/zsh -c sleep 999
90000     1 90000   501   0.0   01:00:00 /usr/libexec/agente
95000     1 94000   502   1.0      05:00 python3 -
97615 97602 97615   501   3.0      40:00 claude
`

const LSOF = [
  'p63959', 'f1', `n${TAREA('b1')}`, 'f2', `n${TAREA('b1')}`,
  'p70001', 'f1', `n${TAREA('b2')}`,
  'p80000', 'f1', `n${TAREA('b3')}`,
  'p90000', 'f1', 'n/dev/null',
  'p95000', 'f1', `n${TAREA('b4')}`,
].join('\n')

describe('parsearPs', () => {
  it('lee pid, padre, grupo, usuario, cpu, edad y comando con espacios', () => {
    const f = parsearPs(PS)
    expect(f).toHaveLength(7)
    expect(f[0]).toEqual({ pid: 63959, ppid: 1, pgid: 63950, uid: 501, cpu: 99.1, segundos: 3 * 86400 + 2 * 3600 + 10 * 60 + 5, comando: '/usr/bin/python3 -' })
  })

  it('etime en sus tres formas', () => {
    expect(segundosDeEtime('00:59')).toBe(59)
    expect(segundosDeEtime('01:00:00')).toBe(3600)
    expect(segundosDeEtime('2-00:00:01')).toBe(2 * 86400 + 1)
  })

  it('una coma decimal (locale) también es cpu', () => {
    expect(parsearPs('1 1 1 501 12,5 00:01 x')[0]!.cpu).toBe(12.5)
  })
})

describe('detectarHuerfanos', () => {
  const filas = parsearPs(PS)
  const rutas = parsearLsof(LSOF)
  const h = detectarHuerfanos(filas, rutas, { uid: UID, home: HOME })

  it('el python del caso real es huérfano: PPID 1, salida en la tarea, líder muerto', () => {
    expect(h[0]).toMatchObject({ pid: 63959, pgid: 63950, cpu: 99.1, agente: 'claude', proyecto: 'Proyectos-technisis', tarea: 'b1' })
  })

  it('el hijo de una tarea viva NO es huérfano aunque tenga PPID 1', () => {
    expect(h.map((x) => x.pid)).not.toContain(70001)
  })

  it('un líder adoptado por launchd sí lo es: el agente que lo lanzó murió', () => {
    expect(h.map((x) => x.pid)).toContain(80000)
  })

  it('ni los agentes del sistema ni los procesos de otro usuario', () => {
    expect(h.map((x) => x.pid)).not.toContain(90000)
    expect(h.map((x) => x.pid)).not.toContain(95000)
    expect(candidatos(filas, UID).map((f) => f.pid)).not.toContain(95000)
  })

  it('los que más queman van primero', () => {
    expect(h.map((x) => x.pid)).toEqual([63959, 80000])
  })

  it('el grupo de un huérfano son todos los que comparten su PGID', () => {
    expect(grupoDe(filas, 70000).sort()).toEqual([70000, 70001])
  })
})
