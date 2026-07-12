import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TicketLoop } from '../ticket-loop'
import type { Ticket, TicketProvider } from '../integrations/ticket-types'

const ticket: Ticket = {
  key: 'PROJ-1', providerId: 'p1', title: 'Fix', url: 'u', state: 'todo', context: 'ctx',
}

function makeProvider(): TicketProvider {
  return { listMyTickets: vi.fn(async () => [ticket]), transition: vi.fn(async () => {}) }
}

describe('TicketLoop', () => {
  let provider: TicketProvider
  let loop: TicketLoop

  beforeEach(() => {
    provider = makeProvider()
    loop = new TicketLoop()
    loop.register('jira', () => provider)
  })

  it('list delega en el provider registrado', async () => {
    expect(await loop.list('jira', {} as never)).toEqual([ticket])
  })

  it('list con provider desconocido devuelve error tipado, no throw', async () => {
    await expect(loop.list('nope', {} as never)).resolves.toEqual([])
  })

  it('startWork transiciona a in_progress y registra el tracking branch→ticket', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    expect(provider.transition).toHaveBeenCalledWith('p1', 'in_progress')
    expect(loop.trackedTicket('gero/PROJ-1-fix')).toMatchObject({ providerId: 'p1', pluginId: 'jira' })
  })

  it('onPrStateChanged transiciona según el evento', async () => {
    await loop.startWork('jira', ticket, 'gero/PROJ-1-fix', {} as never)
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'open', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'in_review')
    await loop.onPrStateChanged('gero/PROJ-1-fix', 'merged', {} as never)
    expect(provider.transition).toHaveBeenLastCalledWith('p1', 'done')
  })

  it('onPrStateChanged con branch no trackeado es no-op', async () => {
    await expect(loop.onPrStateChanged('otra/rama', 'merged', {} as never)).resolves.toBeUndefined()
  })
})
