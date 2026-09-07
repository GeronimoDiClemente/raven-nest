import { useState, useEffect, useCallback } from 'react'
import type { Ticket } from '../types'

export function useMyTickets(pluginId: string | null) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(pluginId != null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!pluginId) { setTickets([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setTickets(await window.tickets.list(pluginId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [pluginId])

  useEffect(() => { void reload() }, [reload])

  return { tickets, loading, error, reload }
}
