import type { PluginManifest, PluginType } from '../../types'

const TYPES: PluginType[] = ['action', 'panel', 'integration']

export function validateManifest(raw: unknown): PluginManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id === '') return null
  if (typeof m.name !== 'string' || m.name === '') return null
  if (typeof m.type !== 'string' || !TYPES.includes(m.type as PluginType)) return null
  if (typeof m.category !== 'string') return null
  return {
    id: m.id,
    name: m.name,
    description: typeof m.description === 'string' ? m.description : '',
    category: m.category as PluginManifest['category'],
    icon: typeof m.icon === 'string' ? m.icon : '',
    color: typeof m.color === 'string' ? m.color : '#888',
    type: m.type as PluginType,
    publisher: typeof m.publisher === 'string' ? m.publisher : 'raven',
    tier: (typeof m.tier === 'string' ? m.tier : 'free') as PluginManifest['tier'],
    comingSoon: m.comingSoon === true,
    auth: m.auth as PluginManifest['auth'],
    configSchema: m.configSchema as PluginManifest['configSchema'],
    contributes: m.contributes as PluginManifest['contributes'],
  }
}
