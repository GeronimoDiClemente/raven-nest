import { useCallback, useEffect, useState } from 'react'
import { projectBoard, type BoardRow } from '../integrations/board'
import { useInstalledPlugins } from './useInstalledPlugins'
import type { Ticket, WorktreeMeta, WorktreeSignalDTO } from '../types'

const TICKET_PLUGINS = ['jira', 'linear', 'github']

/** Assembles the orchestration board from the live bridges. `personalLogin`
 *  tells org from personal scope (empty string → everything reads as org). */
export function useBoardRows(personalLogin = ''): { rows: BoardRow[]; refresh: () => void } {
  const { installed } = useInstalledPlugins()
  const [rows, setRows] = useState<BoardRow[]>([])

  const refresh = useCallback(async () => {
    const w = window as unknown as {
      tickets?: { list: (id: string) => Promise<Ticket[]>; tracked: () => Promise<Array<{ branch: string; ticketKey: string }>> }
      worktree?: { listAll: () => Promise<{ ok: true; worktrees: WorktreeMeta[] } | { ok: false; error: string }> }
      signals?: { list: () => Promise<WorktreeSignalDTO[]> }
    }
    const ticketPlugins = installed.map((p) => p.pluginId).filter((id) => TICKET_PLUGINS.includes(id))
    const perPlugin = await Promise.all(
      ticketPlugins.map(async (id) => ((await w.tickets?.list(id)) ?? []).map((ticket) => ({ pluginId: id, ticket }))),
    )
    const tickets = perPlugin.flat()
    const links = (await w.tickets?.tracked()) ?? []
    const wtRes = await w.worktree?.listAll()
    const worktrees = wtRes && wtRes.ok ? wtRes.worktrees : []
    const signals = (await w.signals?.list()) ?? []
    const sigByPath = new Map(signals.map((s) => [s.repoPath, s]))
    setRows(projectBoard({
      tickets, worktrees, signals, links, personalLogin,
      repoFullName: (p) => sigByPath.get(p)?.repo ?? null,
    }))
  }, [installed, personalLogin])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const w = window as unknown as { signals?: { onUpdate?: (cb: () => void) => () => void } }
    return w.signals?.onUpdate?.(() => { void refresh() })
  }, [refresh])

  return { rows, refresh }
}
