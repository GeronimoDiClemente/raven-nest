// El corte comercial (Task 1): mientras `pro` y `cloud` conviven, un usuario en `cloud`
// tiene que verse como lo que es. `planLabel` solo conocía `pro`, así que un perfil ya
// migrado caía en el `return 'Free'` final: el que paga se veía como gratis.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}))

vi.mock('../../hooks/useUserIdentity', () => ({
  useUserIdentity: () => ({ email: 'gero@nestmux.com', displayName: 'Gero', avatarUrl: null, provider: null }),
}))

import UserMenu from '../../components/UserMenu'

const baseProps = { isTrialActive: false, trialDaysLeft: 0, onUpgrade: vi.fn(), expanded: true }

describe('UserMenu — el plan cloud', () => {
  // El plan salió de la FILA el 2026-09-13: era el segundo renglón que hacía de ésta la única
  // fila de dos líneas de la barra. Sigue estando donde se consulta —el tooltip y el menú que
  // se abre al tocarla— así que el test mira ahí, que es donde el usuario lo lee.
  it('lo muestra como Cloud, no como Free, al abrir el menú', () => {
    render(<UserMenu {...baseProps} plan="cloud" />)
    fireEvent.click(screen.getByRole('button', { name: /gero/i }))

    expect(screen.getAllByText('Cloud').length).toBeGreaterThan(0)
    expect(screen.queryByText('Free')).toBeNull()
  })

  it('y el tooltip de la fila lo dice sin abrir nada', () => {
    render(<UserMenu {...baseProps} plan="cloud" />)
    expect(screen.getByRole('button', { name: /gero/i }).getAttribute('title')).toMatch(/Cloud/)
  })

  it('le da su propio punto de color en vez del de free', () => {
    const { container } = render(<UserMenu {...baseProps} plan="cloud" />)

    expect(container.querySelector('.user-menu-dot--free')).toBeNull()
    expect(container.querySelector('.user-menu-dot--cloud')).not.toBeNull()
  })
})
