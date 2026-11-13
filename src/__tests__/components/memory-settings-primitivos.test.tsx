import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Switch } from '@/components/ui/switch'
import SettingRow from '../../components/memories/settings/SettingRow'
import SettingsSection from '../../components/memories/settings/SettingsSection'
import SettingsSectionList from '../../components/memories/settings/SettingsSectionList'

describe('SettingRow', () => {
  it('nombre a la izquierda, qué es debajo, control a la derecha y el detalle a todo el ancho', () => {
    render(
      <SettingRow id="fila" nombre="Spellcheck" descripcion="Underline misspelled words while you write."
        control={<Switch aria-labelledby="fila" checked={false} onCheckedChange={() => {}} />}>
        <p>detalle</p>
      </SettingRow>,
    )
    expect(screen.getByRole('switch', { name: 'Spellcheck' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Underline misspelled words while you write.').className).toMatch(/text-muted-foreground/)
    expect(screen.getByText('Spellcheck').className).toMatch(/font-medium/)
    const fila = document.querySelector('[data-slot="setting-row"]')!
    expect(fila.className).toMatch(/border-b/)
    expect(fila.className).toMatch(/border-border/)
    expect(within(fila as HTMLElement).getByText('detalle')).toBeInTheDocument()
  })

  it('sin detalle no deja un contenedor vacío', () => {
    render(<SettingRow nombre="Reset graph to defaults">{null}{false}</SettingRow>)
    const fila = document.querySelector('[data-slot="setting-row"]')!
    expect(fila.children).toHaveLength(1)
  })

  // Final review I1 (Ruling 3): con la columna angosta, line-clamp cortaba con "…" justo lo
  // que importa (el comando de login, "You will not see it again."). El "máx. 2 líneas" del
  // spec es un límite para el copy, no un recorte.
  it('la descripción no se recorta', () => {
    render(<SettingRow nombre="Machine without a browser" descripcion="A server, VM or SSH box. Run npx @nestmux/memory login there and approve the code it shows." />)
    const desc = screen.getByText(/approve the code it shows/)
    expect(desc.className).not.toMatch(/line-clamp|truncate/)
  })
})

describe('Switch', () => {
  it('cambia con un click', () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Live preview" checked={true} onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Live preview' }))
    expect(onCheckedChange).toHaveBeenCalledWith(false)
  })
})

describe('SettingsSection y SettingsSectionList', () => {
  it('la sección tiene su título como heading y su bajada', () => {
    render(<SettingsSection titulo="Sync" bajada="Your memory on every machine you sign in to."><p>filas</p></SettingsSection>)
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeInTheDocument()
    expect(screen.getByText('Your memory on every machine you sign in to.')).toBeInTheDocument()
  })

  it('la lista marca la activa y avisa la elegida', () => {
    const onElegir = vi.fn()
    render(<SettingsSectionList secciones={[{ id: 'sync', titulo: 'Sync' }, { id: 'disk', titulo: 'Notes on disk' }]} activa="sync" onElegir={onElegir} />)
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'Sync' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Sync' }).className).toMatch(/bg-accent/)
    fireEvent.click(within(nav).getByRole('button', { name: 'Notes on disk' }))
    expect(onElegir).toHaveBeenCalledWith('disk')
  })
})

describe('memories/settings no trae estilos sueltos', () => {
  const dir = resolve(process.cwd(), 'src/components/memories/settings')
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
    it(`${f}: sin style inline, sin sp-*, sin window.*`, () => {
      const src = readFileSync(resolve(dir, f), 'utf8')
      expect(src).not.toMatch(/style=\{/)
      expect(src).not.toMatch(/\bsp-[a-z]/)
      expect(src).not.toMatch(/window\.(memory|settings)/)
    })
  }
})
