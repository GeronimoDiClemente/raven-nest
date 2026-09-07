// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { IntegrationLogo } from '../../components/IntegrationLogos'

describe('IntegrationLogo', () => {
  it.each(['github', 'slack', 'jira', 'notion', 'gcal', 'linear', 'figma', 'sentry'])(
    'renders a real <svg> mark for %s, not a letter',
    (id) => {
      const { container } = render(<IntegrationLogo id={id} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(container.textContent).toBe('') // no letter/text fallback
    },
  )

  it('falls back to the generic glyph for an unknown id, without crashing', () => {
    const { container } = render(<IntegrationLogo id="totally-unknown-plugin" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.textContent).toBe('')
  })

  it('respects the size prop', () => {
    const { container } = render(<IntegrationLogo id="github" size={32} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('32')
    expect(svg?.getAttribute('height')).toBe('32')
  })

  it('Slack keeps its iconic 4-color mark instead of inheriting currentColor', () => {
    const { container } = render(<IntegrationLogo id="slack" />)
    const fills = new Set(
      Array.from(container.querySelectorAll('path')).map((p) => p.getAttribute('fill')),
    )
    expect(fills).toEqual(new Set(['#E01E5A', '#36C5F0', '#2EB67D', '#ECB22E']))
  })
})
