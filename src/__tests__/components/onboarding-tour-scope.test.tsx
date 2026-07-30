// src/__tests__/components/onboarding-tour-scope.test.tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { OnboardingTour } from '../../tutorial/OnboardingTour'
import type { TourStep } from '../../tutorial/types'

const steps: TourStep[] = [{ id: 's', anchor: '[data-tour-id="x"]', title: { en: 'T', es: 'T' }, body: { en: 'B', es: 'B' } }]

function Harness({ anchorInside }: { anchorInside: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div>
      {/* An identical anchor OUTSIDE the sandbox root — mirrors the real app's
          live WorktreesSection rendering the same data-tour-id behind the overlay. */}
      {!anchorInside && <div data-tour-id="x">outside</div>}
      <div ref={ref} className="sandbox-root">
        {anchorInside && <div data-tour-id="x">inside</div>}
        <OnboardingTour steps={steps} onClose={() => {}} rootRef={ref} />
      </div>
    </div>
  )
}

describe('OnboardingTour anchor scoping', () => {
  it('ignores anchors OUTSIDE the provided root (no spotlight)', () => {
    const { container } = render(<Harness anchorInside={false} />)
    expect(container.querySelector('.tour-spotlight')).toBeNull()
  })

  it('finds anchors INSIDE the provided root (spotlight shown)', () => {
    const { container } = render(<Harness anchorInside={true} />)
    expect(container.querySelector('.tour-spotlight')).not.toBeNull()
  })
})
