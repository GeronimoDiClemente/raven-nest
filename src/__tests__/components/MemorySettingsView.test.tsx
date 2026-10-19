import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MemorySettingsView from '../../components/MemorySettingsView'

vi.mock('../../components/CloudMemoryCard', () => ({ default: () => <div>cloud-card</div> }))
vi.mock('../../components/LinkDeviceCard', () => ({ default: () => <div>link-card</div> }))
vi.mock('../../components/SyncServiceCard', () => ({ default: () => <div>service-card</div> }))
vi.mock('../../components/MemoryEncryptionCard', () => ({ default: () => <div>enc-card</div> }))
vi.mock('../../components/TeamEncryptionCard', () => ({ default: () => <div>team-enc-card</div> }))
vi.mock('../../components/ShareProjectCard', () => ({ default: () => <div>share-card</div> }))
vi.mock('../../components/TeamThreadToggle', () => ({ default: () => <div>thread-toggle</div> }))
vi.mock('../../components/MemoryVaultCard', () => ({ default: () => <div>vault-card</div> }))
const team = vi.hoisted(() => ({ activeTeam: null as null | { id: string; name: string } }))
vi.mock('../../hooks/useTeam', () => ({ useTeam: () => team }))

beforeEach(() => { team.activeTeam = null })

describe('MemorySettingsView', () => {
  it('arranca en Sync con sus tres tarjetas', () => {
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={() => {}} />)
    expect(screen.getByText('cloud-card')).toBeInTheDocument()
    expect(screen.getByText('link-card')).toBeInTheDocument()
    expect(screen.getByText('service-card')).toBeInTheDocument()
  })
  it('el rail cambia de sección', () => {
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Encryption/ }))
    expect(screen.getByText('enc-card')).toBeInTheDocument()
    expect(screen.queryByText('cloud-card')).toBeNull()
  })
  it('sin equipo activo no hay tarjeta de equipo', () => {
    render(<MemorySettingsView activeRepoPath="/r" seccionInicial="encryption" onHowItWorks={() => {}} />)
    expect(screen.queryByText('team-enc-card')).toBeNull()
  })
  it('con equipo activo sí', () => {
    team.activeTeam = { id: 't', name: 'STI' }
    render(<MemorySettingsView activeRepoPath="/r" seccionInicial="encryption" onHowItWorks={() => {}} />)
    expect(screen.getByText('team-enc-card')).toBeInTheDocument()
  })
  it('sin repo, This project sólo ofrece vincular uno', () => {
    const onLinkRepo = vi.fn()
    render(<MemorySettingsView activeRepoPath={null} seccionInicial="project" onLinkRepo={onLinkRepo} onHowItWorks={() => {}} />)
    expect(screen.queryByText('share-card')).toBeNull()
    expect(screen.queryByText('thread-toggle')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Link a repo' }))
    expect(onLinkRepo).toHaveBeenCalled()
  })
  it('How Memories works llama al callback', () => {
    const onHowItWorks = vi.fn()
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={onHowItWorks} />)
    fireEvent.click(screen.getByRole('button', { name: /How Memories works/ }))
    expect(onHowItWorks).toHaveBeenCalled()
  })
  it('el evento del tour cambia la sección', () => {
    render(<MemorySettingsView activeRepoPath="/r" onHowItWorks={() => {}} />)
    act(() => { window.dispatchEvent(new CustomEvent('nest:memory-settings-seccion', { detail: 'disk' })) })
    expect(screen.getByText('vault-card')).toBeInTheDocument()
  })
})
