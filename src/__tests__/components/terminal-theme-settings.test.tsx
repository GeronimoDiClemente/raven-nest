import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
      addTerminalTheme: vi.fn(),
      removeTerminalTheme: vi.fn(),
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

/**
 * Importar el tema que YA tenés. El catálogo son trece que elegimos nosotros; esto es la
 * otra mitad, y la que importa más — el usuario llega con su tema configurado hace meses.
 */
describe('Settings · importar un tema', () => {
  const GHOSTTY = [
    // Hex de SEIS dígitos: `#0000` + un dígito da cinco y el parser lo rechaza con razón.
    ...Array.from({ length: 16 }, (_, i) => `palette = ${i}=#0000${(i + 16).toString(16).padStart(2, '0')}`),
    'background = #101010', 'foreground = #eeeeee',
  ].join('\n')

  const abrirCon = (
    leer: () => Promise<unknown>,
    importados: unknown[] = [],
  ) => {
    const addTerminalTheme = vi.fn()
    const removeTerminalTheme = vi.fn()
    ;(window as unknown as { themes: unknown }).themes = { readTerminalThemeFile: leer }
    const userPrefs = {
      prefs: { active_team_id: null, ui_settings: { terminalThemesImportados: importados } },
      loaded: true,
      setActiveTeam: vi.fn(), setFontSize: vi.fn(), setEditorOptions: vi.fn(),
      setEditorTheme: vi.fn(), setTerminalTheme: vi.fn(), setTerminalThemeAutoContrast: vi.fn(),
      addTerminalTheme, removeTerminalTheme,
    }
    render(<SettingsPanel updateState="idle" onCheckUpdates={vi.fn()} userEmail="t@e.com" userPrefs={userPrefs as never} />)
    fireEvent.click(screen.getByTitle('Settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    return { addTerminalTheme, removeTerminalTheme }
  }

  it('un archivo válido se guarda como tema', async () => {
    const { addTerminalTheme } = abrirCon(async () => ({ ok: true, texto: GHOSTTY, nombre: 'MiTema' }))
    fireEvent.click(screen.getByRole('button', { name: /Import a Ghostty or Warp theme/i }))
    await waitFor(() => expect(addTerminalTheme).toHaveBeenCalled())
    expect(addTerminalTheme.mock.calls[0][0].nombre).toBe('MiTema')
    expect(addTerminalTheme.mock.calls[0][0].background).toBe('#101010')
  })

  /**
   * El error del parser se muestra TAL CUAL: dice qué le falta al archivo, no "no se pudo
   * importar". Un error que no dice qué arreglar obliga a adivinar.
   */
  it('un archivo que no es un tema explica por qué', async () => {
    const { addTerminalTheme } = abrirCon(async () => ({ ok: true, texto: '{"nope":1}', nombre: 'X' }))
    fireEvent.click(screen.getByRole('button', { name: /Import a Ghostty or Warp theme/i }))
    await waitFor(() => expect(screen.getByText(/does not look like a Ghostty or Warp theme/i)).toBeInTheDocument())
    expect(addTerminalTheme).not.toHaveBeenCalled()
  })

  it('cancelar el diálogo no hace nada ni muestra error', async () => {
    const { addTerminalTheme } = abrirCon(async () => null)
    fireEvent.click(screen.getByRole('button', { name: /Import a Ghostty or Warp theme/i }))
    await waitFor(() => expect(addTerminalTheme).not.toHaveBeenCalled())
    expect(screen.queryByText(/does not look like/i)).toBeNull()
  })

  // Los importados van en su propio grupo: un tema tuyo no es una versión peor de uno
  // nuestro, y mezclarlos lo esconde entre trece nombres.
  it('los importados aparecen aparte de los del catálogo', () => {
    abrirCon(async () => null, [{
      id: 'mio', nombre: 'El mío', background: '#000', foreground: '#fff',
      cursor: '#fff', selection: '#333', ansi: Array(16).fill('#888'),
    }])
    const select = screen.getByTestId('terminal-theme-select')
    const grupos = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)
    expect(grupos).toEqual(['Built in', 'Imported'])
  })

  it('sin ninguno importado no se dibuja el grupo vacío', () => {
    abrirCon(async () => null, [])
    const select = screen.getByTestId('terminal-theme-select')
    expect(Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)).toEqual(['Built in'])
  })
})
