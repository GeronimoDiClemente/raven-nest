// El corte comercial (Task 1): mientras `pro` y `cloud` conviven, un usuario en `cloud`
// tiene que verse como lo que es. `planLabel` solo conocía `pro`, así que un perfil ya
// migrado caía en el `return 'Free'` final: el que paga se veía como gratis.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn() } },
}))

vi.mock('../../hooks/useUserIdentity', () => ({
  useUserIdentity: () => ({ email: 'gero@nestmux.com', displayName: 'Gero', avatarUrl: null, provider: null }),
}))

import UserMenu from '../../components/UserMenu'

const baseProps = { isTrialActive: false, trialDaysLeft: 0, onUpgrade: vi.fn(), expanded: true }

describe('UserMenu — el plan cloud', () => {
  it('lo muestra como Cloud, no como Free', () => {
    render(<UserMenu {...baseProps} plan="cloud" />)

    expect(screen.getAllByText('Cloud').length).toBeGreaterThan(0)
    expect(screen.queryByText('Free')).toBeNull()
  })

  it('le da su propio punto de color en vez del de free', () => {
    const { container } = render(<UserMenu {...baseProps} plan="cloud" />)

    expect(container.querySelector('.user-menu-dot--free')).toBeNull()
    expect(container.querySelector('.user-menu-dot--cloud')).not.toBeNull()
  })
})
