// Task 4 of worker-spec/model-per-task: NewPaneDialog wires the AI_CONFIG model
// picker into the real launch cmd via appendModelFlag (src/lib/launch-cmd.ts).
// Covers the two shapes: an agent with a `models` list (Claude) shows the
// dropdown and the chosen model reaches onConfirm's cmd string; an agent
// without one (Copilot) shows no dropdown and never appends `--model`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NewPaneDialog from '../../components/NewPaneDialog'

beforeEach(() => {
  Object.assign(window as unknown as Record<string, unknown>, {
    platform: { isWin: false, isMac: true, isLinux: false },
    shells: { detect: vi.fn().mockResolvedValue([]) },
    customCLIs: { list: vi.fn().mockResolvedValue([]) },
    cli: {
      check: vi.fn().mockResolvedValue({ found: true, path: '/usr/bin/x' }),
      install: vi.fn(),
      cancelInstall: vi.fn(),
      onInstallProgress: vi.fn(() => () => {}),
    },
    accounts: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue('/accounts/dir'),
      delete: vi.fn(),
      getDir: vi.fn().mockResolvedValue('/accounts/dir'),
    },
    electronShell: { openExternal: vi.fn() },
  })
})

describe('<NewPaneDialog> model picker', () => {
  it('Claude: shows a model dropdown with opus/sonnet/haiku, and choosing haiku reaches onConfirm as "claude --model haiku"', async () => {
    const onConfirm = vi.fn()
    render(<NewPaneDialog onConfirm={onConfirm} onCancel={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Claude' }))

    const select = await screen.findByLabelText('Model')
    const options = Array.from((select as HTMLSelectElement).options).map(o => o.value)
    expect(options).toEqual(['', 'opus', 'sonnet', 'haiku'])

    fireEvent.change(select, { target: { value: 'haiku' } })

    fireEvent.change(screen.getByPlaceholderText('Account name (e.g. Personal, Work)'), {
      target: { value: 'Work' },
    })
    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const cmd = onConfirm.mock.calls[0]![4]
    expect(cmd).toBe('claude --model haiku')
  })

  it('switching agents resets the model: Claude=haiku -> Back -> Gemini shows Default model, not haiku', async () => {
    render(<NewPaneDialog onConfirm={vi.fn()} onCancel={vi.fn()} />)

    // Claude -> pick a non-default model
    fireEvent.click(await screen.findByRole('button', { name: 'Claude' }))
    const claudeSelect = await screen.findByLabelText('Model')
    fireEvent.change(claudeSelect, { target: { value: 'haiku' } })
    expect((claudeSelect as HTMLSelectElement).value).toBe('haiku')

    // Back to the agent picker (the dialog's "← Back" control)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    // Gemini has its own models list; its dropdown must start at the default, NOT haiku
    fireEvent.click(await screen.findByRole('button', { name: 'Gemini' }))
    const geminiSelect = await screen.findByLabelText('Model')
    expect((geminiSelect as HTMLSelectElement).value).toBe('')
    const options = Array.from((geminiSelect as HTMLSelectElement).options).map(o => o.value)
    expect(options).not.toContain('haiku')
    expect(options).toEqual(['', 'gemini-2.5-pro', 'gemini-2.5-flash'])
  })

  it('preset agent+model: opens straight on Claude with the model preselected; confirming yields "claude --model haiku"', async () => {
    const onConfirm = vi.fn()
    render(<NewPaneDialog onConfirm={onConfirm} onCancel={vi.fn()} presetAgent="claude" presetModel="haiku" />)

    // Started on Claude's account step (no agent-grid click) with model preselected.
    const select = await screen.findByLabelText('Model')
    expect((select as HTMLSelectElement).value).toBe('haiku')

    // Complete the account step exactly as the manual flow would.
    fireEvent.change(screen.getByPlaceholderText('Account name (e.g. Personal, Work)'), {
      target: { value: 'Work' },
    })
    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirm.mock.calls[0]![0]).toBe('claude')
    expect(onConfirm.mock.calls[0]![4]).toBe('claude --model haiku')
  })

  it('Copilot: shows no model dropdown, and the confirmed command has no --model', async () => {
    const onConfirm = vi.fn()
    render(<NewPaneDialog onConfirm={onConfirm} onCancel={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Copilot' }))

    await screen.findByPlaceholderText('Account name (e.g. Personal, Work)')
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Account name (e.g. Personal, Work)'), {
      target: { value: 'Work' },
    })
    fireEvent.click(screen.getByRole('button', { name: /login/i }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    const cmd = onConfirm.mock.calls[0]![4]
    expect(cmd).toBe('gh copilot')
    expect(cmd).not.toContain('--model')
  })
})
