import { useEffect, useRef } from 'react'

interface TeamsKeyboardOptions {
  onClose: () => void
  onSectionChange: (section: string) => void
  currentSection: string
}

const G_CHORD_MAP: Record<string, string> = {
  r: 'repos',
  i: 'issues',
  m: 'members',
  a: 'activity',
  s: 'snippets',
}

const G_CHORD_TIMEOUT_MS = 1500

export function useTeamsKeyboard({ onClose, onSectionChange, currentSection }: TeamsKeyboardOptions) {
  // useRef to avoid capturing stale callbacks in the event listener
  const onCloseRef = useRef(onClose)
  const onSectionChangeRef = useRef(onSectionChange)
  const currentSectionRef = useRef(currentSection)
  const waitingForChordRef = useRef(false)
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  onCloseRef.current = onClose
  onSectionChangeRef.current = onSectionChange
  currentSectionRef.current = currentSection

  useEffect(() => {
    const clearChordState = () => {
      waitingForChordRef.current = false
      if (chordTimerRef.current !== null) {
        clearTimeout(chordTimerRef.current)
        chordTimerRef.current = null
      }
    }

    const handler = (e: KeyboardEvent) => {
      // Ignore keystrokes while typing in inputs / textareas
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Escape → close workspace
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        clearChordState()
        onCloseRef.current()
        return
      }

      // Cmd/Ctrl+K → command palette
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        clearChordState()
        console.log('[TeamsKeyboard] command palette (Cmd/Ctrl+K)')
        return
      }

      // G chord: second key
      if (waitingForChordRef.current) {
        const key = e.key.toLowerCase()
        const section = G_CHORD_MAP[key]
        clearChordState()
        if (section) {
          e.preventDefault()
          onSectionChangeRef.current(section)
        }
        return
      }

      // G chord: first key — 'g' without any modifier
      if (
        e.key === 'g' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        waitingForChordRef.current = true
        chordTimerRef.current = setTimeout(clearChordState, G_CHORD_TIMEOUT_MS)
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearChordState()
    }
  }, []) // no dependencies: we use refs for everything
}
