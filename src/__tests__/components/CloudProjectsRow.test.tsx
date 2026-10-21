import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
})
