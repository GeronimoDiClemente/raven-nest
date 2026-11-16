import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import OrphanProcesses, { edad, comandoCorto } from '../../components/OrphanProcesses'
import type { OrphanProcess } from '../../types'

const PYTHON: OrphanProcess = {
  pid: 63959, pgid: 63950, cpu: 99.1, segundos: 3 * 86_400 + 60, comando: '/usr/bin/python3 -',
  agente: 'claude', proyecto: 'Proyectos-technisis', tarea: 'b1',
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OrphanProcesses', () => {
  it('sin huérfanos no dibuja nada', () => {
    const { container } = render(<OrphanProcesses huerfanos={[]} onKill={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('muestra el comando, el proyecto, el pid, la edad y el cpu', () => {
    render(<OrphanProcesses huerfanos={[PYTHON]} onKill={vi.fn()} />)
    expect(screen.getByText('ORPHANED PROCESSES')).toBeTruthy()
    expect(screen.getByText('python3 -')).toBeTruthy()
    expect(screen.getByTitle('/usr/bin/python3 -')).toBeTruthy()
    expect(screen.getByText('Proyectos-technisis · PID 63959 · 3d')).toBeTruthy()
    expect(screen.getByText('99.1%')).toBeTruthy()
  })

  it('matar pide confirmación; sin confirmar no mata', () => {
    const onKill = vi.fn(async () => ({ ok: true as const }))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<OrphanProcesses huerfanos={[PYTHON]} onKill={onKill} />)
    fireEvent.click(screen.getByLabelText('Kill python3 -'))
    expect(onKill).not.toHaveBeenCalled()
  })

  it('confirmado, mata ese pid y muestra el error si el main lo rechaza', async () => {
    const onKill = vi.fn(async () => ({ ok: false as const, error: 'That process is no longer an orphan' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OrphanProcesses huerfanos={[PYTHON]} onKill={onKill} />)
    fireEvent.click(screen.getByLabelText('Kill python3 -'))
    expect(onKill).toHaveBeenCalledWith(63959)
    await waitFor(() => expect(screen.getByText('That process is no longer an orphan')).toBeTruthy())
  })

  it('el comando sin el path del ejecutable', () => {
    expect(comandoCorto('/Applications/Xcode.app/Contents/Developer/usr/bin/python3 -c while True: pass')).toBe('python3 -c while True: pass')
    expect(comandoCorto('node server.js')).toBe('node server.js')
  })

  it('la edad en días, horas o minutos', () => {
    expect(edad(3 * 86_400)).toBe('3d')
    expect(edad(5 * 3_600)).toBe('5h')
    expect(edad(30)).toBe('1m')
  })

  it('no tiene literales de color: el aviso es el token --warn', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../../components/OrphanProcesses.tsx'), 'utf8')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/rgba?\(\s*\d/)
  })
})
