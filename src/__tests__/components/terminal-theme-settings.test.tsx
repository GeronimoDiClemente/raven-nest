import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsPanel from '../../components/SettingsPanel'
import { TEMAS, TEMA_NEST } from '../../lib/terminal-themes'

/**
 * El selector de tema de terminal. Hasta hoy Nest tenía UN tema escrito a mano adentro de
 * `useXterm.ts`, sin forma de cambiarlo.
 */
describe('Settings · Terminal', () => {
  const abrir = () => {
    const setTerminalTheme = vi.fn()
    const setTerminalThemeAutoContrast = vi.fn()
    const userPrefs = {
      prefs: { active_team_id: null, ui_settings: {} },
      loaded: true,
      setActiveTeam: vi.fn(),
      setFontSize: vi.fn(),
      setEditorOptions: vi.fn(),
      setEditorTheme: vi.fn(),
      setTerminalTheme,
      setTerminalThemeAutoContrast,
    }
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="t@e.com" userPrefs={userPrefs as never} />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    return { setTerminalTheme, setTerminalThemeAutoContrast }
  }

  it('lista los trece temas del catálogo', () => {
    abrir()
    const select = screen.getByTestId('terminal-theme-select') as HTMLSelectElement
    expect(select.options).toHaveLength(TEMAS.length)
    expect(select.value).toBe(TEMA_NEST.id)
  })

  it('elegir uno lo guarda por id, no por nombre', () => {
    const { setTerminalTheme } = abrir()
    fireEvent.change(screen.getByTestId('terminal-theme-select'), { target: { value: 'dracula' } })
    expect(setTerminalTheme).toHaveBeenCalledWith('dracula')
  })

  it('el ajuste de contraste se puede prender', () => {
    const { setTerminalThemeAutoContrast } = abrir()
    fireEvent.click(screen.getByTestId('terminal-theme-contrast'))
    expect(setTerminalThemeAutoContrast).toHaveBeenCalledWith(true)
  })

  /**
   * La vista previa existe porque un NOMBRE no dice nada: "Everforest Dark Hard" no se parece
   * a nada hasta que lo ves, y elegir a ciegas entre trece nombres es peor que no poder
   * elegir.
   */
  it('muestra una vista previa con el peor contraste del tema', () => {
    abrir()
    expect(screen.getByText(/git status/)).toBeInTheDocument()
    expect(screen.getByTitle(/Worst contrast/i)).toBeInTheDocument()
  })
})
