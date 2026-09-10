import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../styles/global.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('un solo acento, y es acromático', () => {
  // El barrido original buscaba hex y no vio nada escrito como rgba().
  // Este test cierra las DOS formas para que no vuelva a pasar.
  it('no queda el azul viejo en ninguna notación', () => {
    expect(css).not.toMatch(/#0066[fF][fF]/i)
    expect(css).not.toMatch(/rgba?\(\s*0\s*,\s*102\s*,\s*255/i)
  })

  it('no quedan los violetas viejos en ninguna notación', () => {
    expect(css).not.toMatch(/#7c3aed/i)
    expect(css).not.toMatch(/#[aA]78[bB][fF][aA]/i)
    expect(css).not.toMatch(/rgba?\(\s*124\s*,\s*58\s*,\s*237/i)
    expect(css).not.toMatch(/rgba?\(\s*167\s*,\s*139\s*,\s*250/i)
  })

  // Guard genérico: en vez de listar los matices que se convirtieron el
  // 2026-09-10 (14 variantes, 31 ocurrencias entre hex y rgba decimal), esto
  // mide el matiz de CADA hex que quede en el archivo (fuera de comentarios)
  // con la misma heurística que se usó para encontrarlas, así que agarra
  // cualquier variante nueva sin que haga falta nombrarla acá. Cubre tanto
  // hex de 6 dígitos como de 8 (con alpha) — de los de 8 solo se mira el
  // canal de color, ignorando el alpha, con la misma prueba de matiz.
  //
  // NO cubre `rgba()` en general: eso son las aserciones específicas de
  // arriba (azul viejo, violetas viejos) más las de la ronda 2 del reporte.
  // Un azul nuevo escrito como `rgba(59,130,246,.4)` en vez de hex se le
  // cuela a este test — habría que parsear rgba() para atajarlo y no vale
  // la pena todavía. Documentado también en task-6b-report.md, ronda 3.
  //
  // ── Por qué existe la allowlist de abajo, y qué hace falta para tocarla ──
  // Cada entrada es una excepción YA REVISADA contra su selector: son
  // colores deliberados de una leyenda categórica, de un sub-tema propio,
  // de un ícono de sintaxis por lenguaje, o del spotlight de un coachmark —
  // nunca el acento viejo que se coló de nuevo. Agregar una entrada acá
  // significa hacer ese mismo argumento (selector, por qué es intencional,
  // por qué no es el acento) en el PR y en task-6b-report.md — no silenciar
  // un fallo del test porque el build tiene que quedar verde. Si no podés
  // explicar la entrada con una frase como las de abajo, no es una excepción
  // legítima: es el bug que este test existe para agarrar.
  //   - a855f7 / 3b82f6: paleta categórica de PR/eventos (estado y tipo se
  //     distinguen por color, como una leyenda; 3b82f6 es Tailwind blue-500,
  //     el mismo caso que el coordinador marcó explícitamente).
  //   - 7c5cfc / b8a3ff: tier "enterprise" del menú de usuario — es una
  //     leyenda categórica de planes (free/cloud/pro/team/enterprise), no el
  //     acento; convertirlo lo volvía indistinguible de cloud/pro mientras
  //     team (ámbar) al lado seguía teniendo su propio color.
  //   - 5a7bb5 / 9db8e8 / 7da6ff: sub-tema propio del Integration Panel
  //     (.ip-*), con su propia paleta slate/navy separada del resto de la app.
  //   - 8fa3ff / b6c2ff: .wt-pr-chip, comentado a mano en el CSS como
  //     "indigo sutil" elegido para no competir con el status dot.
  //   - aecaff / 3d79ff / 2f6dff: acento del tour/coachmark, deliberadamente
  //     azul para resaltar contra el fondo atenuado durante el onboarding.
  //   - 56b6c2: color de ícono de archivo .css en la paleta de íconos por
  //     lenguaje (cada extensión tiene su propio matiz; este es el suyo).
  // Cualquier hex azul/violeta que NO esté en esta lista hace fallar el
  // test — esa es la variante nueva que hay que revisar, no permitir.
  it('no aparecen hex azules/violetas cromáticas fuera de las excepciones ya revisadas', () => {
    const allowedExceptions = new Set([
      'a855f7', '3b82f6',
      '7c5cfc', 'b8a3ff',
      '5a7bb5', '9db8e8', '7da6ff',
      '8fa3ff', 'b6c2ff',
      'aecaff', '3d79ff', '2f6dff',
      '56b6c2',
    ])

    // 6 dígitos, opcionalmente seguidos de 2 más (alpha de un hex de 8) —
    // en ambos casos el canal de color son los primeros 6.
    const hexes = css.match(/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g) ?? []
    const chromaticBlueViolet = hexes
      .map((hex) => hex.slice(1, 7).toLowerCase())
      .filter((hex) => {
        const r = parseInt(hex.slice(0, 2), 16)
        const g = parseInt(hex.slice(2, 4), 16)
        const b = parseInt(hex.slice(4, 6), 16)
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        return b > r && b >= g && max - min > 70
      })

    const unexpected = chromaticBlueViolet.filter((hex) => !allowedExceptions.has(hex))
    expect(unexpected).toEqual([])
  })
})
