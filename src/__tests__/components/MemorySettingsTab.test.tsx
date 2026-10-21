import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemorySettingsTab, { type MemorySettingsTabProps } from '../../components/MemorySettingsTab'
import { DEFAULT_MEMORY_PREFS } from '../../lib/memory-prefs'

vi.mock('../../components/CloudMemoryCard', () => ({ default: () => <div>cloud-card</div> }))
vi.mock('../../components/LinkDeviceCard', () => ({ default: () => <div>link-card</div> }))
vi.mock('../../components/SyncServiceCard', () => ({ default: () => <div>service-card</div> }))
vi.mock('../../components/MemoryEncryptionCard', () => ({ default: () => <div>enc-card</div> }))
vi.mock('../../components/TeamEncryptionCard', () => ({ default: () => <div>team-enc-card</div> }))
vi.mock('../../components/ShareProjectCard', () => ({ default: () => <div>share-card</div> }))
vi.mock('../../components/TeamThreadToggle', () => ({ default: (p: { hilo: { enabled: boolean } }) => <div>thread-toggle {String(p.hilo.enabled)}</div> }))
vi.mock('../../components/MemoryVaultCard', () => ({ default: () => <div>vault-card</div> }))
const team = vi.hoisted(() => ({ activeTeam: null as null | { id: string; name: string } }))
vi.mock('../../hooks/useTeam', () => ({ useTeam: () => team }))

const hilo = { ready: true, projectKey: 'pk', enabled: true, error: null, cargaFallida: false, setEnabled: vi.fn() }
const montar = (over: Partial<MemorySettingsTabProps> = {}) => {
  const p: MemorySettingsTabProps = {
    seccion: 'sync', onSeccion: vi.fn(), activeRepoPath: '/repos/raven-nest', onLinkRepo: vi.fn(), hilo,
    prefs: DEFAULT_MEMORY_PREFS, prefsCargadas: true, onPrefs: vi.fn(), onResetGraph: vi.fn(), ...over,
  }
  render(<MemorySettingsTab {...p} />)
  return p
}

beforeEach(() => { team.activeTeam = null })

describe('MemorySettingsTab', () => {
  it('Sync: título, bajada y sus tarjetas', () => {
    montar()
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.getByText('Your memory on every machine you sign in to.')).toBeInTheDocument()
    expect(screen.getByText('cloud-card')).toBeInTheDocument()
  })

  it('Encryption: la de equipo sólo con un equipo activo', () => {
    montar({ seccion: 'encryption' })
    expect(screen.getByText('The server stores your memory without being able to read it.')).toBeInTheDocument()
    expect(screen.getByText('enc-card')).toBeInTheDocument()
    expect(screen.queryByText('team-enc-card')).toBeNull()
  })

  it('Encryption con equipo activo muestra la de equipo', () => {
    team.activeTeam = { id: 't', name: 'STI' }
    montar({ seccion: 'encryption' })
    expect(screen.getByText('team-enc-card')).toBeInTheDocument()
  })

  it('Editor & graph: sus filas, y un cambio va a onPrefs', () => {
    const p = montar({ seccion: 'editor' })
    expect(screen.getByRole('heading', { name: 'Editor & graph' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Spellcheck' }))
    expect(p.onPrefs).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(p.onResetGraph).toHaveBeenCalled()
  })

  it('This project con repo: «Settings for <repo>.», compartir y el toggle con el hilo compartido', () => {
    montar({ seccion: 'project' })
    expect(screen.getByText(/Settings for/)).toBeInTheDocument()
    expect(screen.getByText('raven-nest').className).toMatch(/font-mono/)
    expect(screen.getByText('share-card')).toBeInTheDocument()
    expect(screen.getByText('thread-toggle true')).toBeInTheDocument()
  })

  it('This project con un path de Windows muestra sólo el nombre de la carpeta', () => {
    montar({ seccion: 'project', activeRepoPath: 'C:\\repos\\raven-nest' })
    expect(screen.getByText('raven-nest').className).toMatch(/font-mono/)
    expect(screen.queryByText(/C:/)).toBeNull()
  })

  it('This project sin repo: sólo ofrece vincular uno', () => {
    const p = montar({ seccion: 'project', activeRepoPath: null })
    expect(screen.getByText('Open a repo in this tab to see its settings.')).toBeInTheDocument()
    expect(screen.queryByText('share-card')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link a repo' }))
    expect(p.onLinkRepo).toHaveBeenCalled()
  })

  it('Notes on disk', () => {
    montar({ seccion: 'disk' })
    expect(screen.getByText('vault-card')).toBeInTheDocument()
  })

  it('Advanced lleva el servidor propio', () => {
    montar({ seccion: 'advanced' })
    expect(screen.getByText('Only if your company runs its own Nest server.')).toBeInTheDocument()
    expect(screen.getByText('service-card')).toBeInTheDocument()
  })
})
