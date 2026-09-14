import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsPanel from '../../components/SettingsPanel'

/**
 * Una seccion por vez, en vez de las nueve apiladas.
 *
 * `Account` sola mide 215 lineas y las ultimas cinco juntas suman menos que ella, asi que
 * para llegar a `Terminal` habia que pasar por todo eso. El rail ya existia pero solo hacia
 * `scrollIntoView`: era el indice de un documento largo, no una navegacion.
 */
describe('Settings muestra una seccion por vez', () => {
  const abrir = () => {
    const userPrefs = {
      prefs: { active_team_id: null, ui_settings: {} },
      loaded: true,
      setActiveTeam: vi.fn(), setFontSize: vi.fn(), setEditorOptions: vi.fn(),
      setEditorTheme: vi.fn(), setTerminalTheme: vi.fn(), setTerminalThemeAutoContrast: vi.fn(), addTerminalTheme: vi.fn(), removeTerminalTheme: vi.fn(),
    }
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="t@e.com" userPrefs={userPrefs as never} />)
    fireEvent.click(screen.getByTitle('Settings'))
  }

  /** `hidden` es lo que usa `Seccion` para esconder lo que no corresponde. */
  const visible = (titulo: string): boolean => {
    const h = screen.getAllByRole('heading', { name: titulo, hidden: true })[0]
    return h.closest('section')?.hasAttribute('hidden') === false
  }

  it('arranca en la primera y no muestra las demas', () => {
    abrir()
    expect(visible('Account')).toBe(true)
    expect(visible('Terminal')).toBe(false)
    expect(visible('Benchmarks')).toBe(false)
  })

  it('el rail cambia de seccion, no scrollea', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(visible('Terminal')).toBe(true)
    expect(visible('Account')).toBe(false)
  })

  /**
   * Lo decisivo, y la razon por la que esto no pierde nada: el buscador CRUZA el limite de la
   * seccion activa. Si no, buscar "theme" parado en Account no encontraria nada y el buscador
   * pasaria a servir solo adentro de lo que ya estas mirando — justo cuando no lo necesitas.
   */
  it('el buscador encuentra en secciones que no son la activa', () => {
    abrir()
    expect(visible('Terminal')).toBe(false)
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'terminal' } })
    expect(visible('Terminal')).toBe(true)
  })

  // Lo que tenias escrito filtraba OTRA cosa: dejarlo puesto mostraria la seccion nueva vacia
  // sin decir por que.
  it('cambiar de seccion limpia la busqueda', () => {
    abrir()
    const buscador = screen.getByLabelText('Search settings') as HTMLInputElement
    fireEvent.change(buscador, { target: { value: 'zzzz-no-existe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Voice' }))
    expect(buscador.value).toBe('')
    expect(visible('Voice')).toBe(true)
  })
})

/**
 * `Account` eran tres cosas distintas en 216 líneas: tu identidad, los servicios conectados,
 * y la memoria de nube. Una sección que hace tres cosas es una sección que no se puede
 * nombrar, y el rail no servía para llegar a ninguna de las tres.
 */
describe('Account se partió en tres', () => {
  const abrir = () => {
    const userPrefs = {
      prefs: { active_team_id: null, ui_settings: {} },
      loaded: true,
      setActiveTeam: vi.fn(), setFontSize: vi.fn(), setEditorOptions: vi.fn(),
      setEditorTheme: vi.fn(), setTerminalTheme: vi.fn(), setTerminalThemeAutoContrast: vi.fn(),
      addTerminalTheme: vi.fn(), removeTerminalTheme: vi.fn(),
    }
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="t@e.com" userPrefs={userPrefs as never} />)
    fireEvent.click(screen.getByTitle('Settings'))
  }
  const visible = (titulo: string): boolean => {
    const h = screen.getAllByRole('heading', { name: titulo, hidden: true })[0]
    return h.closest('section')?.hasAttribute('hidden') === false
  }

  it('las tres están en el rail', () => {
    abrir()
    for (const t of ['Account', 'Connections', 'Cloud memory']) {
      expect(screen.getByRole('button', { name: t }), t).toBeInTheDocument()
    }
  })

  it('cada una muestra lo suyo y no lo de las otras', () => {
    abrir()
    expect(visible('Account')).toBe(true)
    expect(screen.getByText('t@e.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connections' }))
    expect(visible('Connections')).toBe(true)
    expect(visible('Account')).toBe(false)
    expect(screen.getByText('GitHub')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cloud memory' }))
    expect(visible('Cloud memory')).toBe(true)
    expect(visible('Connections')).toBe(false)
  })

  // Sign out sigue con tu identidad, no perdido entre los servicios.
  it('Sign out vive con la cuenta', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
