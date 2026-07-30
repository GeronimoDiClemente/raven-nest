// src/__tests__/components/bridge-context.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useBridge, BridgeProvider } from '../../lib/bridge'

function Probe({ testid }: { testid: string }) {
  const b = useBridge() as unknown as { marker?: string }
  return <div data-testid={testid}>{b.marker ?? 'none'}</div>
}

describe('bridge context isolation', () => {
  afterEach(() => {
    delete (window as unknown as { marker?: string }).marker
  })

  it('useBridge returns window.* by default (no provider)', () => {
    ;(window as unknown as { marker: string }).marker = 'WINDOW'
    render(<Probe testid="p" />)
    expect(screen.getByTestId('p')).toHaveTextContent('WINDOW')
  })

  it('useBridge returns the provider value inside BridgeProvider', () => {
    const mock = { marker: 'DEMO' } as unknown as Window & typeof globalThis
    render(
      <BridgeProvider value={mock}>
        <Probe testid="p" />
      </BridgeProvider>,
    )
    expect(screen.getByTestId('p')).toHaveTextContent('DEMO')
  })

  it('does NOT leak: a sibling outside the provider still sees window', () => {
    ;(window as unknown as { marker: string }).marker = 'WINDOW'
    const mock = { marker: 'DEMO' } as unknown as Window & typeof globalThis
    render(
      <div>
        <BridgeProvider value={mock}>
          <Probe testid="inside" />
        </BridgeProvider>
        <Probe testid="outside" />
      </div>,
    )
    expect(screen.getByTestId('inside')).toHaveTextContent('DEMO')
    expect(screen.getByTestId('outside')).toHaveTextContent('WINDOW')
  })
})
