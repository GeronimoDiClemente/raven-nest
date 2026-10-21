import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CloudProjectsRow from '../../components/memories/settings/CloudProjectsRow'

const nest = [{ projectKey: 'k-nest', name: 'raven-nest' }]
const afuera = [{ projectKey: 'k-api', name: 'api' }, { projectKey: 'k-web', name: 'web' }]

describe('CloudProjectsRow (spec 2b-1 §4.4)', () => {
  it('con tope y nada afuera: nombre, «1 of 1 · raven-nest» y sin Upgrade', () => {
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} />)
    expect(screen.getByText('Projects in the cloud')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 · raven-nest')).toBeInTheDocument()
    expect(screen.queryByText(/Local only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('con repos afuera: la línea y Upgrade', () => {
    const onUpgrade = vi.fn()
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={1} fuera={afuera} onUpgrade={onUpgrade} />)
    expect(screen.getByText('Local only: api, web — Cloud syncs all your projects.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  it('sin tope (Cloud) no ofrece Upgrade aunque el doctor traiga retenidas viejas (Review Focus 2)', () => {
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={100} fuera={afuera} onUpgrade={vi.fn()} />)
    expect(screen.getByText('1 project')).toBeInTheDocument()
    expect(screen.queryByText(/Local only/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Upgrade' })).toBeNull()
  })

  it('un repo que ya está en la nube no figura afuera (Review Focus 3)', () => {
    render(<CloudProjectsRow enLaNube={nest} maxProyectos={1} fuera={[...nest, afuera[0]]} onUpgrade={vi.fn()} />)
    expect(screen.getByText('Local only: api — Cloud syncs all your projects.')).toBeInTheDocument()
  })

  describe('por encima del tope (spec 2b-2 §4.8)', () => {
    const tres = [{ projectKey: 'k-a', name: 'api' }, { projectKey: 'k-n', name: 'raven-nest' }, { projectKey: 'k-w', name: 'web' }]
    const ERROR = "Couldn't change the synced project. Try again."

    it('descripción, Keep syncing con el elegido y Upgrade', () => {
      const onUpgrade = vi.fn()
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={onUpgrade} overLimit keptProjectKey="k-n" onKeep={vi.fn()} />)
      expect(screen.getByText('Your plan syncs 1 of 3 projects.')).toBeInTheDocument()
      expect(screen.getByText('Keep syncing')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('raven-nest')
      fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
      expect(onUpgrade).toHaveBeenCalledTimes(1)
    })

    it('sin elección muestra el primero del roster (el más viejo)', () => {
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} overLimit keptProjectKey={null} onKeep={vi.fn()} />)
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('api')
    })

    it('elegir otro llama onKeep con su key', async () => {
      const onKeep = vi.fn()
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} overLimit keptProjectKey="k-n" onKeep={onKeep} />)
      fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
      fireEvent.click(await screen.findByRole('option', { name: 'web' }))
      expect(onKeep).toHaveBeenCalledWith('k-w')
    })

    it('un Free que nunca pagó (sin overLimit) no ve el select: 2b-1 intacto', () => {
      render(<CloudProjectsRow enLaNube={[tres[1]]} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} />)
      expect(screen.getByText('1 of 1 · raven-nest')).toBeInTheDocument()
      expect(screen.queryByText('Keep syncing')).toBeNull()
    })

    // Ruling P8: si el daemon no pudo elegir, la fila lo dice y el select vuelve a lo guardado.
    it('si elegir falla: el error en la fila y el select vuelve al guardado', async () => {
      const onKeep = vi.fn().mockResolvedValue({ ok: false, error: 'network' })
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} overLimit keptProjectKey="k-n" onKeep={onKeep} />)
      fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
      fireEvent.click(await screen.findByRole('option', { name: 'web' }))
      expect(await screen.findByText(ERROR)).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('raven-nest')
    })

    it('si elegir falla sin elección guardada, vuelve al más viejo', async () => {
      const onKeep = vi.fn().mockResolvedValue({ ok: false })
      render(<CloudProjectsRow enLaNube={tres} maxProyectos={1} fuera={[]} onUpgrade={vi.fn()} overLimit keptProjectKey={null} onKeep={onKeep} />)
      fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
      fireEvent.click(await screen.findByRole('option', { name: 'web' }))
      expect(await screen.findByText(ERROR)).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('api')
    })

    // Task 8: el status que vuelve con keepProject puede traer todavía el elegido VIEJO; la
    // fila muestra lo elegido hasta que un status nuevo lo confirme o lo contradiga.
    it('elegir bien: muestra lo elegido aunque el status siga con el viejo, hasta que cambie', async () => {
      const onKeep = vi.fn().mockResolvedValue({ ok: true })
      const props = { enLaNube: tres, maxProyectos: 1, fuera: [], onUpgrade: vi.fn(), overLimit: true, onKeep }
      const { rerender } = render(<CloudProjectsRow {...props} keptProjectKey="k-n" />)
      fireEvent.click(screen.getByRole('combobox', { name: 'Keep syncing' }))
      fireEvent.click(await screen.findByRole('option', { name: 'web' }))
      await waitFor(() => expect(onKeep).toHaveBeenCalledWith('k-w'))
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('web')

      // El status viejo (mismo keptProjectKey) no lo pisa.
      rerender(<CloudProjectsRow {...props} keptProjectKey="k-n" />)
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('web')

      // Un status que dice otra cosa, sí.
      rerender(<CloudProjectsRow {...props} keptProjectKey="k-a" />)
      expect(screen.getByRole('combobox', { name: 'Keep syncing' })).toHaveTextContent('api')
      expect(screen.queryByText(ERROR)).toBeNull()
    })
  })
})
