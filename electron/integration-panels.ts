// Host genérico para los paneles de integración (spec §3/§6/§7, plan Hito 2+
// Task F1). Cada servicio (Slack/GitHub/Jira/Notion) registra acá un
// `ServerPanelAdapter` main-side que hace fetch real con el token guardado en
// PluginCredentialStore. El renderer nunca ve el token: llama por IPC
// `plugins:panel:call` (ver main.ts) y consume la respuesta a través del
// proxy `src/integrations/ipcAdapter.ts`.
//
// electron/ no importa desde src/ (boundary renderer/main — ver cómo el
// resto de electron/*.ts evita imports de src/), así que estos tipos
// duplican la forma de `src/integrations/types.ts` en vez de reexportarlos.

export interface WorktreeContext {
  repoPath: string | null
  branch: string | null
}

export interface ItemRef {
  sectionId: string
  itemId: string
}

export interface SectionItem {
  id: string
  title: string
  subtitle?: string
  accent?: string
}

export interface Section {
  id: string
  label: string
  items: SectionItem[]
}

export type DetailBlock =
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string; tag?: string }
  | { kind: 'comment'; author: string; when: string; text: string }

export interface DetailModel {
  ref: ItemRef
  title: string
  key?: string
  status?: string
  meta: { label: string; value: string }[]
  blocks: DetailBlock[]
}

export interface PanelAction {
  id: string
  label: string
  kind: 'primary' | 'secondary'
}

export interface ComposeBody {
  text: string
  terminalOutput?: string
}

export interface PanelAdapterDeps {
  getToken(pluginId: string): string | null
  getConfig(pluginId: string): Record<string, unknown>
  fetch: typeof fetch
}

// Contrato server-side: misma forma que IntegrationAdapter (src/integrations/types.ts)
// salvo por `id`/`displayName`, que son de concern del renderer.
export interface ServerPanelAdapter {
  fetchSections(ctx: WorktreeContext): Promise<Section[]>
  fetchDetail(ref: ItemRef): Promise<DetailModel>
  resolveWorktreeEntity(ctx: WorktreeContext): Promise<ItemRef | null>
  actions(detail: DetailModel): PanelAction[]
  runAction(actionId: string, ref: ItemRef): Promise<void>
  compose(target: ItemRef, body: ComposeBody): Promise<void>
}

// Un adapter tira esto cuando el método necesita auth y `getToken` devolvió
// null — el host lo mapea a NOT_CONNECTED sin filtrar detalles internos.
export class NotConnectedError extends Error {
  constructor() {
    super('NOT_CONNECTED')
    this.name = 'NotConnectedError'
  }
}

export type PanelErrorCode = 'NOT_CONNECTED' | 'NOT_FOUND' | 'API_ERROR'

export type PanelCallResult =
  | { ok: true; data: unknown }
  | { ok: false; error: PanelErrorCode; message?: string }

type PanelAdapterFactory = (deps: PanelAdapterDeps) => ServerPanelAdapter

// Métodos invocables por IPC. `actions` queda afuera a propósito: es sync en
// el contrato y viaja empaquetado junto a la respuesta de `fetchDetail` (ver
// más abajo) — el proxy renderer (ipcAdapter.ts) lo cachea por ref y así
// puede exponer `actions(detail)` sin otro roundtrip.
const CALLABLE_METHODS = ['fetchSections', 'fetchDetail', 'resolveWorktreeEntity', 'runAction', 'compose'] as const
type CallableMethod = typeof CALLABLE_METHODS[number]

const registry = new Map<string, PanelAdapterFactory>()

export function registerPanelAdapter(pluginId: string, factory: PanelAdapterFactory): void {
  registry.set(pluginId, factory)
}

// Solo para tests: limpia el registry global entre casos/archivos.
export function resetPanelAdapters(): void {
  registry.clear()
}

function isCallableMethod(method: string): method is CallableMethod {
  return (CALLABLE_METHODS as readonly string[]).includes(method)
}

export async function callPanel(
  pluginId: string,
  method: string,
  args: unknown[],
  deps: PanelAdapterDeps,
): Promise<PanelCallResult> {
  const factory = registry.get(pluginId)
  if (!factory) {
    return { ok: false, error: 'NOT_FOUND', message: `No panel adapter registered for "${pluginId}"` }
  }
  if (!isCallableMethod(method)) {
    return { ok: false, error: 'NOT_FOUND', message: `Unknown panel method "${method}"` }
  }

  const adapter = factory(deps)
  try {
    if (method === 'fetchDetail') {
      const detail = await adapter.fetchDetail(args[0] as ItemRef)
      const actions = adapter.actions(detail)
      return { ok: true, data: { detail, actions } }
    }
    const fn = adapter[method] as (...a: unknown[]) => unknown
    const data = await fn.apply(adapter, args)
    return { ok: true, data: data ?? null }
  } catch (err) {
    if (err instanceof NotConnectedError) return { ok: false, error: 'NOT_CONNECTED' }
    return { ok: false, error: 'API_ERROR', message: err instanceof Error ? err.message : String(err) }
  }
}
