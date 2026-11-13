// @vitest-environment jsdom
// RecipesView is read-only: it loads bus recipes via window.recipes.list()
// and renders each as a "when -> commands" row.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { RecipesView } from '../../components/RecipesView'

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    recipes: {
      list: vi.fn().mockResolvedValue([
        { id: 'default:pr.merged', when: 'pr.merged', commands: ['updateStatus: done', 'notify #channel', 'logOutcome'] },
      ]),
    },
  })
})

describe('<RecipesView>', () => {
  it('renders the when pill and each command chip', async () => {
    render(<RecipesView />)

    await waitFor(() => expect(screen.getByText('pr.merged')).toBeInTheDocument())
    expect(screen.getByText('updateStatus: done')).toBeInTheDocument()
    expect(screen.getByText('notify #channel')).toBeInTheDocument()
    expect(screen.getByText('logOutcome')).toBeInTheDocument()
  })

  it('shows the empty state when there are no recipes', async () => {
    Object.assign(window as unknown as Record<string, unknown>, {
      recipes: { list: vi.fn().mockResolvedValue([]) },
    })

    render(<RecipesView />)

    await waitFor(() => expect(screen.getByText('No recipes yet.')).toBeInTheDocument())
  })
})
