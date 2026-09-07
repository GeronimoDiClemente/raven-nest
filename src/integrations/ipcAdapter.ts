// Proxy renderer-side genérico: implementa IntegrationAdapter delegando cada
// método a window.pluginPanels.call(pluginId, method, args), que enruta al
// host main-side (electron/integration-panels.ts). Los adapters reales
// (Slack/GitHub/Jira/Notion) viven main-side — acá solo hay IPC.
import type {
  IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, PanelAction, ComposeBody,
} from './types'

export type PanelErrorCode = 'NOT_CONNECTED' | 'NOT_FOUND' | 'API_ERROR'

export class PanelError extends Error {
  code: PanelErrorCode
  constructor(code: PanelErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PanelError'
    this.code = code
  }
}

async function call<T>(pluginId: string, method: string, args: unknown[]): Promise<T> {
  const res = await window.pluginPanels.call(pluginId, method, args)
  if (!res.ok) throw new PanelError(res.error, res.message)
  return res.data as T
}

function refKey(ref: ItemRef): string {
  return `${ref.sectionId}:${ref.itemId}`
}

export function createIpcAdapter(pluginId: string, displayName: string): IntegrationAdapter {
  // `actions(detail)` es sync en el contrato IntegrationAdapter — no puede
  // hacer su propio roundtrip IPC. El host empaqueta { detail, actions } en
  // la respuesta de fetchDetail (ver integration-panels.ts) y acá cacheamos
  // las actions por ref para poder devolverlas sin llamar a IPC de nuevo.
  const actionsByRef = new Map<string, PanelAction[]>()

  return {
    id: pluginId,
    displayName,
    fetchSections: (ctx: WorktreeContext) => call<Section[]>(pluginId, 'fetchSections', [ctx]),
    fetchDetail: async (ref: ItemRef) => {
      const { detail, actions } = await call<{ detail: DetailModel; actions: PanelAction[] }>(
        pluginId, 'fetchDetail', [ref],
      )
      actionsByRef.set(refKey(detail.ref), actions)
      return detail
    },
    resolveWorktreeEntity: (ctx: WorktreeContext) => call<ItemRef | null>(pluginId, 'resolveWorktreeEntity', [ctx]),
    actions: (detail: DetailModel) => actionsByRef.get(refKey(detail.ref)) ?? [],
    runAction: (actionId: string, ref: ItemRef) => call<void>(pluginId, 'runAction', [actionId, ref]),
    compose: (target: ItemRef, body: ComposeBody) => call<void>(pluginId, 'compose', [target, body]),
  }
}
