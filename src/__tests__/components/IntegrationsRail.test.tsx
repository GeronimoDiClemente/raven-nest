import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { IntegrationsRail } from '../../components/IntegrationsRail'
import type { ActivityEntry } from '../../types'

function todayIso(hour: number): string {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

const rows = [
  {
    key: '#189', title: 'Race board', url: '', providerId: 'x', pluginId: 'github', ticketState: 'in_review',
    status: 'needs_you', branch: 'gero/189-race', worktreePath: '/r', repoFullName: 'RAVEN/x',
    scope: { kind: 'org', org: 'RAVEN' }, ci: 'success', changesRequested: true, prNumber: 1,
  },
  {
    key: '#221', title: 'Design import', url: '', providerId: 'y', pluginId: 'github', ticketState: 'in_progress',
    status: 'working', branch: 'gero/221-design', worktreePath: '/r2', repoFullName: 'RAVEN/x',
    scope: { kind: 'org', org: 'RAVEN' }, ci: null, changesRequested: false, prNumber: null,
  },
] as any

describe('<IntegrationsRail>', () => {
  it('shows the bot widget, the needs-you row with its count, and the activity placeholder', () => {
    render(<IntegrationsRail rows={rows} />)

    expect(screen.getByText('@Nest')).toBeInTheDocument()
    expect(screen.getByText(/Race board/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Activity will appear here.')).toBeInTheDocument()
  })

  it('does not list the working row under needs you', () => {
    render(<IntegrationsRail rows={rows} />)
    expect(screen.queryByText(/Design import/)).not.toBeInTheDocument()
  })

  it('calls onOpenRow with the clicked needs-you row', () => {
    const onOpenRow = vi.fn()
    render(<IntegrationsRail rows={rows} onOpenRow={onOpenRow} />)
    fireEvent.click(screen.getByText(/Race board/))
    expect(onOpenRow).toHaveBeenCalledWith(rows[0])
  })

  it('calls onOpenRow when Enter is pressed on the needs-you row', () => {
    const onOpenRow = vi.fn()
    render(<IntegrationsRail rows={rows} onOpenRow={onOpenRow} />)
    fireEvent.keyDown(screen.getByText(/Race board/).closest('[role="button"]')!, { key: 'Enter' })
    expect(onOpenRow).toHaveBeenCalledWith(rows[0])
  })
})

describe('<IntegrationsRail> activity feed', () => {
  const entry: ActivityEntry = {
    ev: { type: 'pr.merged', branch: 'feat/x', repoFullName: 'RAVEN/x' },
    ts: 1_000,
  }

  afterEach(() => {
    // @ts-expect-error test-only cleanup of the bridged global
    delete window.activity
  })

  it('loads entries from window.activity.list() on mount', async () => {
    window.activity = {
      list: vi.fn().mockResolvedValue([entry]),
      onAppend: vi.fn().mockReturnValue(() => {}),
    }
    render(<IntegrationsRail rows={rows} />)
    expect(await screen.findByText(/merged/)).toBeInTheDocument()
    expect(screen.queryByText('Activity will appear here.')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no entries', () => {
    window.activity = {
      list: vi.fn().mockResolvedValue([]),
      onAppend: vi.fn().mockReturnValue(() => {}),
    }
    render(<IntegrationsRail rows={rows} />)
    expect(screen.getByText('Activity will appear here.')).toBeInTheDocument()
  })

  it('prepends entries pushed live via onAppend', async () => {
    let pushed: ((e: ActivityEntry) => void) | undefined
    window.activity = {
      list: vi.fn().mockResolvedValue([entry]),
      onAppend: vi.fn((cb: (e: ActivityEntry) => void) => { pushed = cb; return () => {} }),
    }
    render(<IntegrationsRail rows={rows} />)
    await screen.findByText(/merged/)

    act(() => {
      pushed?.({ ev: { type: 'ci.failed', branch: 'feat/y', repoFullName: 'RAVEN/x' }, ts: 2_000 })
    })

    expect(await screen.findByText(/CI failed/)).toBeInTheDocument()
    expect(screen.getByText(/merged/)).toBeInTheDocument()
  })

  it('renders the empty placeholder when window.activity is not bridged', () => {
    render(<IntegrationsRail rows={rows} />)
    expect(screen.getByText('Activity will appear here.')).toBeInTheDocument()
  })
})

describe('<IntegrationsRail> Today (calendar block→session)', () => {
  afterEach(() => {
    // @ts-expect-error test-only cleanup of the bridged global
    delete window.gcal
  })

  it('does not render the Today section when onStartCalendarSession is omitted', () => {
    render(<IntegrationsRail rows={rows} />)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
  })

  it('renders a "Today" header and forwards Start session clicks with the event summary/description', async () => {
    // @ts-expect-error partial bridge is enough for this test
    window.gcal = {
      listEvents: vi.fn().mockResolvedValue([
        { id: '1', summary: 'Standup', description: 'daily', start: { dateTime: todayIso(9) } },
      ]),
      startSession: vi.fn(),
    }
    const onStartCalendarSession = vi.fn()
    render(<IntegrationsRail rows={rows} onStartCalendarSession={onStartCalendarSession} />)

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(await screen.findByText('Standup')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(onStartCalendarSession).toHaveBeenCalledWith('Standup', 'daily')
  })

  it('shows the calendar error text when calendarError is set', async () => {
    // @ts-expect-error partial bridge is enough for this test
    window.gcal = { listEvents: vi.fn().mockResolvedValue([]), startSession: vi.fn() }
    render(<IntegrationsRail rows={rows} onStartCalendarSession={vi.fn()} calendarError="Open a repo tab first to create a worktree" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Open a repo tab first to create a worktree')
  })
})
