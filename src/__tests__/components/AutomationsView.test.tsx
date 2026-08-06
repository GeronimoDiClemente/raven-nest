// @vitest-environment jsdom
// AutomationsView is a coming-soon placeholder for time-driven agents
// (contrasted with the event-driven Recipes).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AutomationsView } from '../../components/AutomationsView'

describe('<AutomationsView>', () => {
  it('renders the title and the coming-soon copy', () => {
    render(<AutomationsView />)

    expect(screen.getByText('Automations')).toBeInTheDocument()
    expect(screen.getByText(/Coming soon/)).toBeInTheDocument()
  })
})
