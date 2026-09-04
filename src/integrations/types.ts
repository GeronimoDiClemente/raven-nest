// src/integrations/types.ts
// Contrato entre el shell del panel y cada integración (spec §3).
// Los adapters reales (Slack/GitHub/Jira/Notion) implementan esto con
// fetch en el main process; el shell solo conoce esta interfaz.

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
  accent?: string // ej. clave de issue 'RAV-231'
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
  key?: string        // 'RAV-231', '#142'
  status?: string     // 'In Progress', 'Abierta'
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
  terminalOutput?: string // bloque de código adjuntado desde el terminal
}

export interface IntegrationAdapter {
  id: string
  displayName: string
  fetchSections(ctx: WorktreeContext): Promise<Section[]>
  fetchDetail(ref: ItemRef): Promise<DetailModel>
  resolveWorktreeEntity(ctx: WorktreeContext): Promise<ItemRef | null>
  actions(detail: DetailModel): PanelAction[]
  runAction(actionId: string, ref: ItemRef): Promise<void>
  compose(target: ItemRef, body: ComposeBody): Promise<void>
}
