// workspace-shell-design §3: "si no hay ningun pane en ese path, no se
// muestra nada. Un slot vacio NO se rellena con un icono gris." Estos tests
// pinman el comportamiento del que depende esa regla en el render.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AILogoStack } from '../../components/AILogoStack'

describe('AILogoStack', () => {
  it('renders nothing for an empty aiTypes list', () => {
    const { container } = render(<AILogoStack aiTypes={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one logo per aiType up to the max, aria-hidden (decorative)', () => {
    const { container } = render(<AILogoStack aiTypes={['claude', 'gemini']} />)
    expect(container.querySelectorAll('svg')).toHaveLength(2)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('caps visible logos at 3 and shows a "+N" for the rest', () => {
    const { container } = render(
      <AILogoStack aiTypes={['claude', 'gemini', 'codex', 'copilot', 'qwen']} />,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(3)
    expect(container.textContent).toBe('+2')
  })

  it('renders no "+N" badge when everything fits', () => {
    const { container } = render(<AILogoStack aiTypes={['claude']} />)
    expect(container.textContent).toBe('')
  })

  it('an unknown aiType silently occupies no visual space — no fallback icon', () => {
    // 'terminal' has no entry in AI_LOGOS: AILogo returns null for it.
    const { container } = render(<AILogoStack aiTypes={['terminal']} />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })
})
