import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import MemoryNoteEditor from '../../components/memories/MemoryNoteEditor'
import type { MemoryObservationDetail } from '../../types'
import { DEFAULT_MEMORY_PREFS } from '../../lib/memory-prefs'

const det = (o: Partial<MemoryObservationDetail> = {}): MemoryObservationDetail => ({
  syncId: 's1', projectKey: 'p1', scope: 'personal', type: 'decision', title: 'Auth', content: 'ver [[Otra]] y [[Falta]]',
  tags: [], topicKey: null, gitBranch: 'main', originAi: null, authorDisplay: null, createdAt: 1, updatedAt: 1,
  supersededBy: null, revisionCount: 1, links: [{ name: 'Otra', syncId: 's2' }, { name: 'Falta', syncId: null }], mentionedIn: [], ...o,
})
const props = () => ({
  ansi: undefined, candidatos: [], externo: null,
  onSave: vi.fn().mockResolvedValue({ ok: true }), onOpen: vi.fn(), onCreate: vi.fn(),
  onOpenNewer: vi.fn(), onConnect: vi.fn(), onDelete: vi.fn().mockResolvedValue(undefined),
})

describe('MemoryNoteEditor', () => {
  it('muestra el titulo editable y el contenido sin HTML', () => {
    render(<MemoryNoteEditor detail={det({ content: '<img src=x onerror=alert(1)>' })} {...props()} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth')
    expect(document.querySelector('.cm-content img')).toBeNull()
  })
  it('click en un link resuelto abre; en uno pendiente ofrece crearla', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Otra"]')!)
    expect(p.onOpen).toHaveBeenCalledWith('s2', { background: false })
    fireEvent.mouseDown(document.querySelector('[data-wikilink="Falta"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Create this memory' }))
    expect(p.onCreate).toHaveBeenCalledWith('Falta')
  })
  it('un wikilink hostil que no esta en los links no abre ni crea nada (Review Focus 5)', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det({ content: 'mira [[javascript:alert(1)]]', links: [] })} {...p} />)
    fireEvent.mouseDown(document.querySelector('[data-wikilink="javascript:alert(1)"]')!)
    expect(p.onOpen).not.toHaveBeenCalled()
    expect(p.onCreate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Create this memory' })).toBeNull()
    expect(document.querySelector('a[href]')).toBeNull()
  })
  it('cambio externo sin cambios locales recarga; con cambios locales muestra la banda (Review Focus 3)', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Auth v2', updatedAt: 2 })} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Auth v2')
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Mio' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Auth v3', updatedAt: 3 })} />)
    expect(screen.getByText(/A newer version replaced this one/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Mio')
  })
  it('el eco de nuestro propio guardado no se toma como cambio externo aunque se siga escribiendo', async () => {
    vi.useFakeTimers()
    try {
      const p = props()
      const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
      const titulo = () => screen.getByRole('textbox', { name: 'Memory title' })
      fireEvent.change(titulo(), { target: { value: 'A1' } })
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(p.onSave).toHaveBeenCalledWith({ title: 'A1', content: 'ver [[Otra]] y [[Falta]]' })
      fireEvent.change(titulo(), { target: { value: 'A12' } })
      rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', updatedAt: 2 })} />)
      expect(screen.queryByText(/A newer version replaced this one/)).toBeNull()
      expect(titulo()).toHaveValue('A12')
      expect(titulo()).not.toHaveAttribute('readonly')
    } finally {
      vi.useRealTimers()
    }
  })
  it('un cambio externo recarga tambien el cuerpo del editor', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ content: 'cuerpo nuevo', updatedAt: 2 })} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('cuerpo nuevo')
  })
  it('una memoria reemplazada es solo lectura y ofrece abrir la nueva', () => {
    const p = props()
    render(<MemoryNoteEditor detail={det({ supersededBy: 's9' })} {...p} />)
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the newer version' }))
    expect(p.onOpenNewer).toHaveBeenCalled()
  })
  it('borrada desde afuera: solo lectura con la banda, sin menu, y no guarda lo escrito', async () => {
    vi.useFakeTimers()
    try {
      const p = props()
      const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
      fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'A medias' } })
      rerender(<MemoryNoteEditor detail={det()} {...p} borrada />)
      expect(screen.getByText('This memory was deleted.')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveAttribute('readonly')
      expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(p.onSave).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

// Fix round 1, Important #1: main guarda con trim y `redact()`, asi que el eco de nuestro
// propio guardado NO es igual a lo que mandamos. Tomarlo por un cambio de otro bloqueaba la
// nota y copiaba al portapapeles el texto SIN redactar.
describe('MemoryNoteEditor: el eco de nuestro guardado', () => {
  const titulo = () => screen.getByRole('textbox', { name: 'Memory title' })
  const vista = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
  const escribirCuerpo = (texto: string) => {
    const view = vista()
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: texto } }) })
  }
  let writeText: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })

  it('eco recortado y redactado mientras se sigue escribiendo: sin banda, editable, nada al portapapeles', async () => {
    const p = props()
    p.onSave.mockResolvedValue({ ok: true, saved: { title: 'A1', content: 'token [REDACTED]' } })
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.change(titulo(), { target: { value: 'A1 ' } })
    escribirCuerpo('token sk-secreto\n')
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(p.onSave).toHaveBeenCalledWith({ title: 'A1 ', content: 'token sk-secreto\n' })
    fireEvent.change(titulo(), { target: { value: 'A1 sigo' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', content: 'token [REDACTED]', updatedAt: 2 })} />)
    expect(screen.queryByText(/A newer version replaced this one/)).toBeNull()
    expect(titulo()).toHaveValue('A1 sigo')
    expect(titulo()).not.toHaveAttribute('readonly')
    expect(vista().state.doc.toString()).toBe('token sk-secreto\n')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('eco que llega ANTES de que el guardado responda: se espera la respuesta y no hay banda', async () => {
    const p = props()
    let responder!: (r: unknown) => void
    p.onSave.mockImplementation(() => new Promise((r) => { responder = r }))
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.change(titulo(), { target: { value: 'A1' } })
    escribirCuerpo('clave sk-x')
    await act(async () => { vi.advanceTimersByTime(1500) })
    fireEvent.change(titulo(), { target: { value: 'A1 mas' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', content: 'clave [REDACTED]', updatedAt: 2 })} />)
    await act(async () => { responder({ ok: true, saved: { title: 'A1', content: 'clave [REDACTED]' } }) })
    expect(screen.queryByText(/A newer version replaced this one/)).toBeNull()
    expect(titulo()).not.toHaveAttribute('readonly')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('main viejo sin saved: el eco se reconoce comparando con trim', async () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.change(titulo(), { target: { value: 'A1 ' } })
    await act(async () => { vi.advanceTimersByTime(1500) })
    fireEvent.change(titulo(), { target: { value: 'A1 x' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', updatedAt: 2 })} />)
    expect(screen.queryByText(/A newer version replaced this one/)).toBeNull()
  })

  it('el eco no deja la pestana en Unsaved por el trim', async () => {
    const p = props()
    p.onSave.mockResolvedValue({ ok: true, saved: { title: 'A1', content: 'ver [[Otra]] y [[Falta]]' } })
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.change(titulo(), { target: { value: 'A1 ' } })
    await act(async () => { vi.advanceTimersByTime(1500) })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', updatedAt: 2 })} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(p.onSave).toHaveBeenCalledTimes(1)
    expect(titulo()).toHaveValue('A1 ')
  })

  it('un cambio externo de verdad con cambios locales sigue mostrando la banda', async () => {
    const p = props()
    p.onSave.mockResolvedValue({ ok: true, saved: { title: 'A1', content: 'ver [[Otra]] y [[Falta]]' } })
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.change(titulo(), { target: { value: 'A1' } })
    await act(async () => { vi.advanceTimersByTime(1500) })
    fireEvent.change(titulo(), { target: { value: 'A1 mio' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Del agente', updatedAt: 2 })} />)
    expect(screen.getByText(/A newer version replaced this one/)).toBeInTheDocument()
    expect(titulo()).toHaveValue('A1 mio')
  })

  it('el eco se consume: un agente que vuelve la nota a nuestro v1 despues es un cambio externo', async () => {
    const p = props()
    p.onSave.mockResolvedValue({ ok: true, saved: { title: 'A1', content: 'ver [[Otra]] y [[Falta]]' } })
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.change(titulo(), { target: { value: 'A1' } })
    await act(async () => { vi.advanceTimersByTime(1500) })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', updatedAt: 2 })} />)
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'Del agente', updatedAt: 3 })} />)
    expect(titulo()).toHaveValue('Del agente')
    fireEvent.change(titulo(), { target: { value: 'Mio' } })
    rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'A1', updatedAt: 4 })} />)
    expect(screen.getByText(/A newer version replaced this one/)).toBeInTheDocument()
    expect(titulo()).toHaveValue('Mio')
  })
})

describe('MemoryNoteEditor: titulo vacio, borrado fallido, irALinea', () => {
  it('un titulo vacio marca el campo y dice Title required', () => {
    render(<MemoryNoteEditor detail={det()} {...props()} />)
    const t = screen.getByRole('textbox', { name: 'Memory title' })
    expect(t).toHaveAttribute('aria-invalid', 'false')
    fireEvent.change(t, { target: { value: '   ' } })
    expect(t).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Title required')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved')).toBeNull()
  })

  // Task 11, en la app real: con `<Button>` (componente funcion de React 18, sin forwardRef)
  // como hijo `asChild` del disparador, Radix no recibia el elemento ancla y el menu quedaba
  // sin posicionar, en `translate(0, -200%)`, fuera de la pantalla. jsdom no tiene layout,
  // pero si deja ver si floating-ui llego a posicionarlo.
  it('el menu "More actions" se posiciona contra su boton (no queda fuera de la pantalla)', async () => {
    render(<MemoryNoteEditor detail={det()} {...props()} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' })
    await screen.findByRole('menuitem', { name: 'Delete' })
    const envoltorio = document.querySelector('[data-radix-popper-content-wrapper]') as HTMLElement
    await vi.waitFor(() => expect(envoltorio.style.transform).not.toContain('-200%'))
  })

  it('si borrar falla, avisa y la nota sigue', async () => {
    const p = props()
    p.onDelete.mockRejectedValue(new Error('disk'))
    render(<MemoryNoteEditor detail={det()} {...p} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete this memory.')).toBeInTheDocument()
    expect(p.onDelete).toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Memory title' })).not.toHaveAttribute('readonly')
  })

  it('irALinea tolera NaN y no enteros', () => {
    const ref = { current: null as null | { irALinea: (n: number) => void } }
    render(<MemoryNoteEditor ref={ref} detail={det({ content: 'a\nb\nc' })} {...props()} />)
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    act(() => { ref.current!.irALinea(Number.NaN) })
    expect(view.state.selection.main.head).toBe(0)
    act(() => { ref.current!.irALinea(2.7) })
    expect(view.state.selection.main.head).toBe(2)
    act(() => { ref.current!.irALinea(99) })
    expect(view.state.selection.main.head).toBe(4)
  })
})

describe('MemoryNoteEditor: final review', () => {
  it('un [[hueco]] deja de ser pendiente cuando llegan links nuevos sin cambiar la version (F1)', () => {
    const p = props()
    const d = det()
    const { rerender } = render(<MemoryNoteEditor detail={d} links={d.links} {...p} />)
    const falta = () => document.querySelector('[data-wikilink="Falta"]') as HTMLElement
    expect(falta().className).toContain('cm-lp-wikilink-pendiente')
    // Alguien escribio «Falta»: la nota fuente es la misma version, sus links no.
    rerender(<MemoryNoteEditor detail={d} links={[{ name: 'Otra', syncId: 's2' }, { name: 'Falta', syncId: 's3' }]} {...p} />)
    expect(falta().className).not.toContain('cm-lp-wikilink-pendiente')
    fireEvent.mouseDown(falta())
    expect(p.onOpen).toHaveBeenCalledWith('s3', { background: false })
    expect(screen.queryByRole('button', { name: 'Create this memory' })).toBeNull()
  })

  it('Ctrl+Z deshace lo escrito en el cuerpo (F2)', () => {
    render(<MemoryNoteEditor detail={det({ content: 'hola' })} {...props()} />)
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' }, userEvent: 'delete' }) })
    expect(view.state.doc.toString()).toBe('')
    act(() => { fireEvent.keyDown(view.contentDOM, { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true }) })
    expect(view.state.doc.toString()).toBe('hola')
    expect(document.querySelector('.cm-content')?.textContent).toBe('hola')
  })

  describe('Ctrl+Z despues de una recarga externa (residual F2)', () => {
    // Sin rAF falso: CM mide el layout en un frame y jsdom no tiene getClientRects.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
    afterEach(() => { vi.useRealTimers() })
    const ctrlZ = (view: EditorView) => act(() => { fireEvent.keyDown(view.contentDOM, { key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true }) })

    it('sin escritura previa: deshacer no revierte lo del agente ni guarda el contenido viejo', async () => {
      const p = props()
      const { rerender } = render(<MemoryNoteEditor detail={det({ content: 'viejo' })} {...p} />)
      const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
      rerender(<MemoryNoteEditor detail={det({ content: 'viejo' })} {...p} externo={det({ content: 'del agente', updatedAt: 2 })} />)
      expect(view.state.doc.toString()).toBe('del agente')
      ctrlZ(view)
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(view.state.doc.toString()).toBe('del agente')
      expect(p.onSave).not.toHaveBeenCalled()
    })

    it('con escritura propia ya guardada antes: deshacer tampoco reintroduce texto anterior a la recarga', async () => {
      const p = props()
      p.onSave.mockResolvedValue({ ok: true, saved: { title: 'Auth', content: 'mio' } })
      const { rerender } = render(<MemoryNoteEditor detail={det({ content: 'viejo' })} {...p} />)
      const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
      act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'mio' }, userEvent: 'input.type' }) })
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(p.onSave).toHaveBeenCalledTimes(1)
      rerender(<MemoryNoteEditor detail={det({ content: 'viejo' })} {...p} externo={det({ content: 'del agente', updatedAt: 3 })} />)
      expect(view.state.doc.toString()).toBe('del agente')
      ctrlZ(view)
      await act(async () => { vi.advanceTimersByTime(3000) })
      expect(view.state.doc.toString()).toBe('del agente')
      expect(p.onSave).toHaveBeenCalledTimes(1)
    })
  })

  it('un cambio externo diferido que vuelve despues de cerrar la pestana no copia nada (minor Task 7)', async () => {
    const responder: Array<(v: { ok: true }) => void> = []
    const p = { ...props(), onSave: vi.fn().mockImplementation(() => new Promise((r) => { responder.push(r) })) }
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    try {
      const { rerender, unmount } = render(<MemoryNoteEditor detail={det()} {...p} />)
      fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Mio' } })
      await act(async () => { vi.advanceTimersByTime(1500) })
      expect(p.onSave).toHaveBeenCalled()
      fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Mio 2' } })
      // Llega un cambio de otro con el guardado en vuelo: se difiere.
      rerender(<MemoryNoteEditor detail={det()} {...p} externo={det({ title: 'De un agente', updatedAt: 5 })} />)
      unmount()
      // El desmontaje guarda lo pendiente (otro guardado en vuelo): responden los dos.
      await act(async () => { for (const r of responder) r({ ok: true }) })
      expect(responder.length).toBeGreaterThan(0)
      expect(writeText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('preferencias del editor', () => {
  const ed = DEFAULT_MEMORY_PREFS.editor
  it('live preview prendido (default) oculta las marcas', () => {
    render(<MemoryNoteEditor detail={det({ content: '**hola**', links: [] })} {...props()} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('hola')
    expect(document.querySelector('.cm-lp-strong')).not.toBeNull()
  })

  it('live preview apagado muestra el Markdown crudo, sin decoraciones ni links clickeables', () => {
    render(<MemoryNoteEditor detail={det({ content: '**hola** [[Otra]]' })} {...props()} prefs={{ ...ed, livePreview: false }} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('**hola** [[Otra]]')
    expect(document.querySelector('.cm-lp-strong')).toBeNull()
    expect(document.querySelector('[data-wikilink]')).toBeNull()
  })

  it('cambiarlo con la nota abierta reconfigura sin perder lo escrito', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det({ content: '**hola**', links: [] })} {...p} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Memory title' }), { target: { value: 'Titulo nuevo' } })
    rerender(<MemoryNoteEditor detail={det({ content: '**hola**', links: [] })} {...p} prefs={{ ...ed, livePreview: false }} />)
    expect(document.querySelector('.cm-content')?.textContent).toBe('**hola**')
    expect(screen.getByRole('textbox', { name: 'Memory title' })).toHaveValue('Titulo nuevo')
  })

  it('spellcheck sigue la preferencia', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    expect(document.querySelector('.cm-content')?.getAttribute('spellcheck')).toBe('false')
    rerender(<MemoryNoteEditor detail={det()} {...p} prefs={{ ...ed, spellcheck: true }} />)
    expect(document.querySelector('.cm-content')?.getAttribute('spellcheck')).toBe('true')
  })

  it('el tamaño de letra va al editor', () => {
    render(<MemoryNoteEditor detail={det()} {...props()} prefs={{ ...ed, fontSize: 16 }} />)
    expect(document.querySelector('.cm-editor')?.getAttribute('style')).toContain('font-size: 16px')
  })

  it('readable width limita el ancho; apagado lo libera', () => {
    const p = props()
    const { rerender } = render(<MemoryNoteEditor detail={det()} {...p} />)
    const caja = () => screen.getByRole('textbox', { name: 'Memory title' }).parentElement!
    expect(caja().className).toMatch(/max-w-\[720px\]/)
    rerender(<MemoryNoteEditor detail={det()} {...p} prefs={{ ...ed, readableWidth: false }} />)
    expect(caja().className).toMatch(/max-w-none/)
  })
})
