import { useState, useEffect, useCallback } from 'react'
import { terminalShareService } from '../lib/terminalShareService'

/** Hook that mirrors the singleton state for a specific pane — the session survives component unmount. */
export function useTerminalShare(paneId: string, onJoinRequest?: () => void) {
  const [shareCode, setShareCode] = useState<string | null>(() => terminalShareService.shareCode(paneId))
  const [isSharing, setIsSharing] = useState(() => terminalShareService.isSharing(paneId))

  useEffect(() => {
    // Sync on mount (in case state changed while unmounted)
    setShareCode(terminalShareService.shareCode(paneId))
    setIsSharing(terminalShareService.isSharing(paneId))
    return terminalShareService.subscribe((changedPaneId) => {
      if (changedPaneId !== paneId) return
      setShareCode(terminalShareService.shareCode(paneId))
      setIsSharing(terminalShareService.isSharing(paneId))
    })
  }, [paneId])

  const startSharing = useCallback(() => {
    terminalShareService.start(paneId)
    if (onJoinRequest) terminalShareService.setJoinRequestCallback(paneId, onJoinRequest)
  }, [paneId, onJoinRequest])

  const stopSharing = useCallback(() => {
    terminalShareService.stop(paneId)
  }, [paneId])

  return { shareCode, isSharing, startSharing, stopSharing }
}

