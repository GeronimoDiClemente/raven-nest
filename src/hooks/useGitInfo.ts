import { useState, useEffect, useCallback, useRef } from 'react'

interface GitInfo {
  branch: string | null
  githubUrl: string | null
  isDirty: boolean
}

export function useGitInfo(repoPath?: string) {
  const [info, setInfo] = useState<GitInfo>({ branch: null, githubUrl: null, isDirty: false })
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!repoPath) {
      if (aliveRef.current) setInfo({ branch: null, githubUrl: null, isDirty: false })
      return
    }
    const result = await window.git.info(repoPath)
    if (!aliveRef.current) return
    setInfo({ branch: result.branch, githubUrl: result.githubUrl, isDirty: result.isDirty })
  }, [repoPath])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  return { ...info, refresh }
}
