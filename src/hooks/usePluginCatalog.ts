import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { validateManifest } from '../lib/plugins/manifest'
import { BUILTIN_CATALOG } from '../lib/plugins/builtinCatalog'
import type { PluginManifest } from '../types'

export function usePluginCatalog() {
  const [catalog, setCatalog] = useState<PluginManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'remote' | 'builtin'>('builtin')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data, error } = await supabase.from('plugin_catalog').select('manifest')
        if (error || !data || data.length === 0) throw error ?? new Error('empty')
        const manifests = data
          .map((r) => validateManifest((r as { manifest: unknown }).manifest))
          .filter((m): m is PluginManifest => m !== null)
        if (manifests.length === 0) throw new Error('no valid manifests')
        if (active) { setCatalog(manifests); setSource('remote') }
      } catch {
        if (active) { setCatalog(BUILTIN_CATALOG); setSource('builtin') }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  return { catalog, loading, source }
}
