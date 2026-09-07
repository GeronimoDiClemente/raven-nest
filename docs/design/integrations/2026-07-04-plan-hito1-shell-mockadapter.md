# Hito 1: IntegrationPanelShell + MockAdapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El shell común de paneles de integración corriendo con datos mock, alcanzable end-to-end en `npm run dev`: instalar "Demo" desde el marketplace → ítem en la Sidebar → panel con navegación, detalle, acciones y compose.

**Architecture:** Un componente contenedor `IntegrationPanelShell` (columna de contexto + área de detalle + compose bar) que consume una interfaz `IntegrationAdapter`. En este hito el único adapter es `mockAdapter` (datos fake en memoria, corre en el renderer). Los adapters reales (hito 2+) implementarán la misma interfaz con fetch en el main process vía IPC — el shell no cambia.

**Tech Stack:** React + TypeScript (renderer), vitest + @testing-library/react (tests en `src/__tests__/`), estilos en `src/styles/global.css` con clases planas (patrón `integrations-*` existente).

**Spec:** `docs/design/integrations/2026-07-04-marketplace-integraciones-v2-design.md` (§3 arquitectura, §8 hito 1). Mockups de referencia: `docs/design/integrations/mockups/jira-view.html` (layout del panel).

**Convenciones del repo que aplican:**
- Tests: `npm test` (vitest run). Los tests viven en `src/__tests__/<área>/<nombre>.test.ts(x)` espejando `src/`.
- `window.plugins` (IPC de Slice 1) ya existe: `list()`, `save()`, `delete()`. En tests se mockea sobre `globalThis.window` (ver `src/__tests__/hooks/useInstalledPlugins.test.tsx`).
- Componentes: función exportada, `className` planos, sin CSS modules.
- Commits en español, prefijo `feat(integrations):` / `test(integrations):`.

---

### Task 1: Contrato del adapter (tipos)

**Files:**
- Create: `src/integrations/types.ts`

- [ ] **Step 1: Crear los tipos**

```ts
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
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos (los tipos no se usan todavía).

- [ ] **Step 3: Commit**

```bash
git add src/integrations/types.ts
git commit -m "feat(integrations): contrato IntegrationAdapter para paneles (hito 1)"
```

---

### Task 2: MockAdapter + registry

**Files:**
- Create: `src/integrations/mockAdapter.ts`
- Create: `src/integrations/registry.ts`
- Test: `src/__tests__/integrations/mockAdapter.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/__tests__/integrations/mockAdapter.test.ts
import { describe, it, expect } from 'vitest'
import { createMockAdapter } from '../../integrations/mockAdapter'
import { getAdapter } from '../../integrations/registry'

const ctx = { repoPath: 'C:/dev/raven-nest', branch: 'feat/integrations' }

describe('mockAdapter', () => {
  it('fetchSections devuelve secciones con items', async () => {
    const a = createMockAdapter()
    const sections = await a.fetchSections(ctx)
    expect(sections.length).toBeGreaterThan(0)
    expect(sections[0].items.length).toBeGreaterThan(0)
  })

  it('resolveWorktreeEntity mapea el branch a un item existente', async () => {
    const a = createMockAdapter()
    const ref = await a.resolveWorktreeEntity(ctx)
    expect(ref).not.toBeNull()
    const detail = await a.fetchDetail(ref!)
    expect(detail.title).toBeTruthy()
  })

  it('resolveWorktreeEntity devuelve null sin branch', async () => {
    const a = createMockAdapter()
    expect(await a.resolveWorktreeEntity({ repoPath: null, branch: null })).toBeNull()
  })

  it('compose agrega un comentario visible en el próximo fetchDetail', async () => {
    const a = createMockAdapter()
    const ref = (await a.resolveWorktreeEntity(ctx))!
    const before = (await a.fetchDetail(ref)).blocks.filter(b => b.kind === 'comment').length
    await a.compose(ref, { text: 'listo', terminalOutput: '$ npm test\n✓ 8 passed' })
    const after = (await a.fetchDetail(ref)).blocks.filter(b => b.kind === 'comment').length
    expect(after).toBe(before + 1)
  })

  it('registry: getAdapter("demo") devuelve el mock, desconocido devuelve null', () => {
    expect(getAdapter('demo')?.id).toBe('demo')
    expect(getAdapter('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/__tests__/integrations/mockAdapter.test.ts`
Expected: FAIL — `Cannot find module '../../integrations/mockAdapter'`

- [ ] **Step 3: Implementar el MockAdapter**

```ts
// src/integrations/mockAdapter.ts
// Adapter de datos fake para el hito 1: valida el shell sin OAuth ni APIs.
// El estado vive en memoria del closure (se resetea al recargar).
import type {
  IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, ComposeBody,
} from './types'

export function createMockAdapter(): IntegrationAdapter {
  const comments: Record<string, { author: string; when: string; text: string }[]> = {}

  const sections: Section[] = [
    {
      id: 'mine', label: 'Mi trabajo',
      items: [
        { id: 'demo-231', title: 'Marketplace de integraciones — OAuth Slack', subtitle: 'In Progress · vos', accent: 'DEMO-231' },
        { id: 'demo-228', title: 'Gate Pro server-side vía Supabase', subtitle: 'To Do · vos', accent: 'DEMO-228' },
      ],
    },
    {
      id: 'recent', label: 'Recientes',
      items: [
        { id: 'demo-209', title: 'Catálogo remoto plugin_catalog', subtitle: 'Code Review', accent: 'DEMO-209' },
      ],
    },
  ]

  const details: Record<string, Omit<DetailModel, 'blocks'> & { description: string }> = {
    'demo-231': {
      ref: { sectionId: 'mine', itemId: 'demo-231' },
      title: 'Marketplace de integraciones — OAuth Slack',
      key: 'DEMO-231', status: 'In Progress',
      meta: [{ label: 'Asignada a', value: 'Gerónimo' }, { label: 'Prioridad', value: 'Alta' }],
      description: 'Item de demo vinculado al branch actual. Probá las acciones y el compose.',
    },
    'demo-228': {
      ref: { sectionId: 'mine', itemId: 'demo-228' },
      title: 'Gate Pro server-side vía Supabase',
      key: 'DEMO-228', status: 'To Do',
      meta: [{ label: 'Asignada a', value: 'Gerónimo' }],
      description: 'Validación del tier contra la DB en cada arranque de sesión de panel.',
    },
    'demo-209': {
      ref: { sectionId: 'recent', itemId: 'demo-209' },
      title: 'Catálogo remoto plugin_catalog',
      key: 'DEMO-209', status: 'Code Review',
      meta: [{ label: 'Asignada a', value: 'Matías' }],
      description: 'Fallback local BUILTIN_CATALOG cuando no hay red.',
    },
  }

  return {
    id: 'demo',
    displayName: 'Demo',
    fetchSections: async () => sections,
    fetchDetail: async (ref: ItemRef) => {
      const d = details[ref.itemId]
      return {
        ...d,
        blocks: [
          { kind: 'text', text: d.description },
          ...(comments[ref.itemId] ?? []).map((c) => ({ kind: 'comment' as const, ...c })),
        ],
      }
    },
    resolveWorktreeEntity: async (ctx: WorktreeContext) =>
      ctx.branch ? { sectionId: 'mine', itemId: 'demo-231' } : null,
    actions: (detail) =>
      detail.status === 'In Progress'
        ? [{ id: 'to-review', label: '→ Code Review', kind: 'secondary' }, { id: 'done', label: '→ Done', kind: 'primary' }]
        : [{ id: 'start', label: '→ In Progress', kind: 'primary' }],
    runAction: async (actionId, ref) => {
      const map: Record<string, string> = { 'to-review': 'Code Review', done: 'Done', start: 'In Progress' }
      details[ref.itemId].status = map[actionId] ?? details[ref.itemId].status
    },
    compose: async (target: ItemRef, body: ComposeBody) => {
      const text = body.terminalOutput ? `${body.text}\n\`\`\`\n${body.terminalOutput}\n\`\`\`` : body.text
      ;(comments[target.itemId] ??= []).push({ author: 'Vos', when: 'ahora', text })
    },
  }
}
```

```ts
// src/integrations/registry.ts
// Mapea pluginId (catálogo) → adapter del panel. Hito 2+ suma slack/github/jira/notion.
import type { IntegrationAdapter } from './types'
import { createMockAdapter } from './mockAdapter'

const adapters: Record<string, () => IntegrationAdapter> = {
  demo: createMockAdapter,
}

export function getAdapter(pluginId: string): IntegrationAdapter | null {
  return adapters[pluginId]?.() ?? null
}

export function hasAdapter(pluginId: string): boolean {
  return pluginId in adapters
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/__tests__/integrations/mockAdapter.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/integrations/ src/__tests__/integrations/
git commit -m "feat(integrations): MockAdapter + registry de adapters (hito 1)"
```

---

### Task 3: Componentes presentacionales del shell

**Files:**
- Create: `src/components/IntegrationPanel/WorktreeContextCard.tsx`
- Create: `src/components/IntegrationPanel/ContextColumn.tsx`
- Create: `src/components/IntegrationPanel/ComposeBar.tsx`
- Test: `src/__tests__/components/IntegrationPanel/presentational.test.tsx`

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
// src/__tests__/components/IntegrationPanel/presentational.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorktreeContextCard } from '../../../components/IntegrationPanel/WorktreeContextCard'
import { ContextColumn } from '../../../components/IntegrationPanel/ContextColumn'
import { ComposeBar } from '../../../components/IntegrationPanel/ComposeBar'

describe('WorktreeContextCard', () => {
  it('muestra branch y entidad resuelta', () => {
    render(<WorktreeContextCard branch="feat/integrations" entityLabel="DEMO-231" />)
    expect(screen.getByText('feat/integrations')).toBeTruthy()
    expect(screen.getByText(/DEMO-231/)).toBeTruthy()
  })
  it('sin branch no renderiza nada', () => {
    const { container } = render(<WorktreeContextCard branch={null} entityLabel={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('ContextColumn', () => {
  const sections = [{
    id: 'mine', label: 'Mi trabajo',
    items: [{ id: 'a', title: 'Item A', subtitle: 'To Do', accent: 'DEMO-1' }],
  }]
  it('lista secciones e items y notifica selección', () => {
    const onSelect = vi.fn()
    render(
      <ContextColumn sections={sections} selected={null} onSelect={onSelect}
        header={{ title: 'Demo', subtitle: 'mock' }} branch={null} entityLabel={null} />,
    )
    fireEvent.click(screen.getByText('Item A'))
    expect(onSelect).toHaveBeenCalledWith({ sectionId: 'mine', itemId: 'a' })
  })
})

describe('ComposeBar', () => {
  it('envía texto y output adjuntado', () => {
    const onSubmit = vi.fn()
    render(<ComposeBar placeholder="Comentar…" onSubmit={onSubmit} getTerminalOutput={() => '$ ok'} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hola' } })
    fireEvent.click(screen.getByText('⌨ Adjuntar output del terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hola', terminalOutput: '$ ok' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/components/IntegrationPanel/presentational.test.tsx`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implementar los tres componentes**

```tsx
// src/components/IntegrationPanel/WorktreeContextCard.tsx
export function WorktreeContextCard({ branch, entityLabel }: { branch: string | null; entityLabel: string | null }) {
  if (!branch) return null
  return (
    <div className="ip-worktree-card">
      <span className="ip-worktree-label">Worktree actual</span>
      <span className="ip-worktree-value">
        <code>{branch}</code>{entityLabel ? <> → {entityLabel}</> : null}
      </span>
    </div>
  )
}
```

```tsx
// src/components/IntegrationPanel/ContextColumn.tsx
import type { Section, ItemRef } from '../../integrations/types'
import { WorktreeContextCard } from './WorktreeContextCard'

interface Props {
  header: { title: string; subtitle?: string }
  sections: Section[]
  selected: ItemRef | null
  onSelect: (ref: ItemRef) => void
  branch: string | null
  entityLabel: string | null
}

export function ContextColumn({ header, sections, selected, onSelect, branch, entityLabel }: Props) {
  return (
    <aside className="ip-context">
      <header className="ip-context-header">
        <span className="ip-context-title">{header.title}</span>
        {header.subtitle && <span className="ip-context-sub">{header.subtitle}</span>}
      </header>
      <WorktreeContextCard branch={branch} entityLabel={entityLabel} />
      {sections.map((s) => (
        <section key={s.id}>
          <h4 className="ip-section-label">{s.label} · {s.items.length}</h4>
          {s.items.map((it) => {
            const ref = { sectionId: s.id, itemId: it.id }
            const on = selected?.itemId === it.id
            return (
              <button key={it.id} className={`ip-item${on ? ' active' : ''}`} onClick={() => onSelect(ref)}>
                {it.accent && <span className="ip-item-accent">{it.accent}</span>}
                <span className="ip-item-body">
                  <span className="ip-item-title">{it.title}</span>
                  {it.subtitle && <span className="ip-item-sub">{it.subtitle}</span>}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </aside>
  )
}
```

```tsx
// src/components/IntegrationPanel/ComposeBar.tsx
import { useState } from 'react'
import type { ComposeBody } from '../../integrations/types'

interface Props {
  placeholder: string
  onSubmit: (body: ComposeBody) => void
  getTerminalOutput?: () => string
}

export function ComposeBar({ placeholder, onSubmit, getTerminalOutput }: Props) {
  const [text, setText] = useState('')
  const [attached, setAttached] = useState<string | undefined>(undefined)
  return (
    <footer className="ip-compose">
      {attached && <pre className="ip-compose-attachment">{attached}</pre>}
      <textarea className="ip-compose-input" placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)} rows={2} />
      <div className="ip-compose-actions">
        {getTerminalOutput && (
          <button className="ip-attach" onClick={() => setAttached(getTerminalOutput())}>
            ⌨ Adjuntar output del terminal
          </button>
        )}
        <button
          className="ip-send"
          disabled={!text.trim() && !attached}
          onClick={() => {
            onSubmit({ text: text.trim(), terminalOutput: attached })
            setText(''); setAttached(undefined)
          }}
        >Enviar</button>
      </div>
    </footer>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/components/IntegrationPanel/presentational.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/IntegrationPanel/ src/__tests__/components/IntegrationPanel/
git commit -m "feat(integrations): componentes presentacionales del panel (hito 1)"
```

---

### Task 4: IntegrationPanelShell (contenedor)

**Files:**
- Create: `src/components/IntegrationPanel/IntegrationPanelShell.tsx`
- Test: `src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx`

- [ ] **Step 1: Escribir el test que falla**

```tsx
// src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntegrationPanelShell } from '../../../components/IntegrationPanel/IntegrationPanelShell'
import { createMockAdapter } from '../../../integrations/mockAdapter'

const ctx = { repoPath: 'C:/dev/raven-nest', branch: 'feat/integrations' }

describe('IntegrationPanelShell', () => {
  it('carga secciones, selecciona la entidad del worktree y muestra el detalle', async () => {
    render(<IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx} />)
    await waitFor(() => expect(screen.getAllByText('Marketplace de integraciones — OAuth Slack').length).toBeGreaterThan(0))
    expect(screen.getByText('In Progress')).toBeTruthy()
  })

  it('una acción actualiza el estado del detalle', async () => {
    render(<IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx} />)
    await waitFor(() => screen.getByText('→ Done'))
    fireEvent.click(screen.getByText('→ Done'))
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy())
  })

  it('compose agrega el comentario al detalle', async () => {
    render(
      <IntegrationPanelShell adapter={createMockAdapter()} worktreeContext={ctx}
        getTerminalOutput={() => '$ npm test'} />,
    )
    await waitFor(() => screen.getByRole('textbox'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'probando compose' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(screen.getByText(/probando compose/)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el shell**

```tsx
// src/components/IntegrationPanel/IntegrationPanelShell.tsx
import { useCallback, useEffect, useState } from 'react'
import type { IntegrationAdapter, Section, DetailModel, ItemRef, WorktreeContext, ComposeBody } from '../../integrations/types'
import { ContextColumn } from './ContextColumn'
import { ComposeBar } from './ComposeBar'

interface Props {
  adapter: IntegrationAdapter
  worktreeContext: WorktreeContext
  getTerminalOutput?: () => string
}

export function IntegrationPanelShell({ adapter, worktreeContext, getTerminalOutput }: Props) {
  const [sections, setSections] = useState<Section[]>([])
  const [selected, setSelected] = useState<ItemRef | null>(null)
  const [detail, setDetail] = useState<DetailModel | null>(null)
  const [worktreeEntity, setWorktreeEntity] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [secs, entityRef] = await Promise.all([
        adapter.fetchSections(worktreeContext),
        adapter.resolveWorktreeEntity(worktreeContext),
      ])
      if (!alive) return
      setSections(secs)
      if (entityRef) {
        setSelected(entityRef)
        const d = await adapter.fetchDetail(entityRef)
        if (!alive) return
        setDetail(d)
        setWorktreeEntity(d.key ?? d.title)
      }
    })()
    return () => { alive = false }
  }, [adapter, worktreeContext])

  const select = useCallback(async (ref: ItemRef) => {
    setSelected(ref)
    setDetail(await adapter.fetchDetail(ref))
  }, [adapter])

  const runAction = useCallback(async (actionId: string) => {
    if (!selected) return
    await adapter.runAction(actionId, selected)
    setDetail(await adapter.fetchDetail(selected))
  }, [adapter, selected])

  const compose = useCallback(async (body: ComposeBody) => {
    if (!selected) return
    await adapter.compose(selected, body)
    setDetail(await adapter.fetchDetail(selected))
  }, [adapter, selected])

  return (
    <div className="ip-shell">
      <ContextColumn
        header={{ title: adapter.displayName }}
        sections={sections} selected={selected} onSelect={(r) => void select(r)}
        branch={worktreeContext.branch} entityLabel={worktreeEntity}
      />
      <div className="ip-main">
        {detail ? (
          <>
            <header className="ip-detail-header">
              {detail.key && <span className="ip-detail-key">{detail.key}</span>}
              <h2 className="ip-detail-title">{detail.title}</h2>
              <div className="ip-detail-row">
                {detail.status && <span className="ip-status">{detail.status}</span>}
                {adapter.actions(detail).map((a) => (
                  <button key={a.id} className={`ip-action ip-action-${a.kind}`} onClick={() => void runAction(a.id)}>
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="ip-detail-meta">
                {detail.meta.map((m) => <span key={m.label}>{m.label} <b>{m.value}</b></span>)}
              </div>
            </header>
            <div className="ip-detail-blocks">
              {detail.blocks.map((b, i) => {
                if (b.kind === 'code') return <pre key={i} className="ip-block-code">{b.code}</pre>
                if (b.kind === 'comment') return (
                  <div key={i} className="ip-block-comment">
                    <span className="ip-comment-who">{b.author} <small>{b.when}</small></span>
                    <span className="ip-comment-text">{b.text}</span>
                  </div>
                )
                return <p key={i} className="ip-block-text">{b.text}</p>
              })}
            </div>
            <ComposeBar placeholder={`Comentar en ${detail.key ?? detail.title}…`}
              onSubmit={(b) => void compose(b)} getTerminalOutput={getTerminalOutput} />
          </>
        ) : (
          <div className="ip-empty">Elegí un ítem de la izquierda</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/IntegrationPanel/IntegrationPanelShell.tsx src/__tests__/components/IntegrationPanel/IntegrationPanelShell.test.tsx
git commit -m "feat(integrations): IntegrationPanelShell contenedor (hito 1)"
```

---

### Task 5: Estilos del panel

**Files:**
- Modify: `src/styles/global.css` (agregar al final, junto a las clases `integrations-*` existentes)

- [ ] **Step 1: Agregar las clases `ip-*`**

Paleta y look según mockup `docs/design/integrations/mockups/jira-view.html` (matte/dark, raven-blue `#0066FF`, bordes `#141416`).

```css
/* ===== Integration Panel (hito 1) ===== */
.ip-shell { display: flex; height: 100%; min-height: 0; background: #08080a; }
.ip-context { width: 290px; flex-shrink: 0; border-right: 1px solid #121214; display: flex; flex-direction: column; overflow-y: auto; }
.ip-context-header { display: flex; flex-direction: column; padding: 14px 16px 12px; border-bottom: 1px solid #121214; }
.ip-context-title { font-size: 13px; font-weight: 650; color: #eef0f4; }
.ip-context-sub { font-size: 10.5px; color: #55555b; }
.ip-worktree-card { margin: 10px 12px; background: #0c1018; border: 1px solid #16233b; border-radius: 10px; padding: 11px 12px; display: flex; flex-direction: column; }
.ip-worktree-label { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #5a7bb5; }
.ip-worktree-value { font-size: 12px; color: #c9d4e6; margin-top: 5px; }
.ip-worktree-value code { font-size: 11px; background: #101a2e; border-radius: 5px; padding: 1px 6px; color: #9db8e8; }
.ip-section-label { font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: #45454b; padding: 12px 16px 6px; margin: 0; }
.ip-item { display: flex; gap: 9px; padding: 9px 16px; width: 100%; text-align: left; background: none; border: none; border-left: 2px solid transparent; cursor: pointer; }
.ip-item.active { background: #0e0f14; border-left-color: #0066FF; }
.ip-item-accent { font-size: 11px; color: #5a7bb5; font-weight: 600; flex-shrink: 0; margin-top: 1px; }
.ip-item-body { display: flex; flex-direction: column; }
.ip-item-title { font-size: 12.5px; color: #c4c4ca; line-height: 1.35; }
.ip-item-sub { font-size: 10.5px; color: #55555b; margin-top: 3px; }
.ip-main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow-y: auto; }
.ip-detail-header { padding: 16px 22px 14px; border-bottom: 1px solid #121214; }
.ip-detail-key { font-size: 11.5px; color: #5a7bb5; font-weight: 600; }
.ip-detail-title { font-size: 17px; font-weight: 650; color: #f0f0f3; margin: 4px 0 0; letter-spacing: -0.01em; }
.ip-detail-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.ip-status { font-size: 11px; font-weight: 600; border-radius: 6px; padding: 4px 10px; background: #101a2e; color: #7da6ff; border: 1px solid #1c2c4a; }
.ip-action { font-size: 11.5px; border-radius: 7px; padding: 4px 11px; cursor: pointer; }
.ip-action-secondary { color: #8a8a92; border: 1px solid #1e1e24; background: none; }
.ip-action-primary { color: #fff; border: 1px solid transparent; background: #0066FF; font-weight: 600; }
.ip-detail-meta { display: flex; gap: 18px; margin-top: 14px; font-size: 11.5px; color: #6a6a72; }
.ip-detail-meta b { color: #a9a9b1; font-weight: 500; }
.ip-detail-blocks { padding: 14px 22px; flex: 1; }
.ip-block-text { font-size: 13px; color: #b4b4bb; line-height: 1.6; max-width: 640px; }
.ip-block-code { margin: 10px 0; background: #0b0b0e; border: 1px solid #191920; border-radius: 9px; padding: 11px 14px; font-size: 11.5px; color: #8fa8d0; white-space: pre-wrap; }
.ip-block-comment { display: flex; flex-direction: column; padding: 10px 0; border-top: 1px solid #101012; }
.ip-comment-who { font-size: 12px; font-weight: 600; color: #d4d4da; }
.ip-comment-who small { color: #55555b; font-weight: 400; margin-left: 6px; }
.ip-comment-text { font-size: 12.5px; color: #a2a2aa; margin-top: 3px; line-height: 1.5; white-space: pre-wrap; }
.ip-compose { border-top: 1px solid #141416; padding: 12px 22px 14px; }
.ip-compose-attachment { background: #0b0b0e; border: 1px solid #16233b; border-radius: 8px; padding: 8px 11px; font-size: 11px; color: #8fa8d0; margin-bottom: 8px; white-space: pre-wrap; }
.ip-compose-input { width: 100%; background: #0c0c0f; border: 1px solid #1c1c22; border-radius: 10px; padding: 10px 13px; font-size: 12.5px; color: #d9d9dd; resize: none; font-family: inherit; }
.ip-compose-actions { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
.ip-attach { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #9aa6d6; background: #0c1018; border: 1px solid #16233b; border-radius: 7px; padding: 5px 11px; cursor: pointer; }
.ip-send { margin-left: auto; font-size: 12px; font-weight: 600; color: #fff; background: #0066FF; border: none; border-radius: 7px; padding: 6px 16px; cursor: pointer; }
.ip-send:disabled { opacity: .4; cursor: default; }
.ip-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #55555b; font-size: 13px; }
/* Host overlay (misma mecánica que .integrations-overlay) */
.ip-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 60; }
.ip-window { width: min(1100px, 92vw); height: min(680px, 88vh); background: #08080a; border: 1px solid #141416; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
.ip-window-bar { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid #121214; color: #eaeaef; font-size: 13px; font-weight: 600; gap: 8px; }
.ip-window-close { margin-left: auto; background: none; border: none; color: #7c7c83; font-size: 16px; cursor: pointer; }
```

- [ ] **Step 2: Verificar que el build no rompe**

Run: `npm run build`
Expected: build OK (CSS es aditivo).

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(integrations): estilos ip-* del panel (hito 1)"
```

---

### Task 6: Wiring — plugin Demo en catálogo, ítem en Sidebar, host en App

**Files:**
- Modify: `src/lib/plugins/builtinCatalog.ts` (agregar plugin `demo`)
- Create: `src/components/SidebarIntegrationItems.tsx`
- Create: `src/components/IntegrationPanel/IntegrationPanelHost.tsx`
- Modify: `src/components/Sidebar.tsx` (render de ítems instalados, nueva prop)
- Modify: `src/App.tsx` (estado + overlay del panel)
- Test: `src/__tests__/components/SidebarIntegrationItems.test.tsx`

- [ ] **Step 1: Agregar `demo` al BUILTIN_CATALOG**

En `src/lib/plugins/builtinCatalog.ts`, agregar al final del array (antes del cierre `]`):

```ts
  {
    id: 'demo', name: 'Demo',
    description: 'Panel de demostración del shell de integraciones (datos fake).',
    category: 'comms', icon: 'demo', color: '#0066FF',
    type: 'integration', publisher: 'raven', tier: 'free',
    auth: { kind: 'none' },
  },
```

Nota: si `PluginCategory` no admite un valor mejor, `comms` sirve — es un plugin interno de validación que después se saca del catálogo (hito 2).

- [ ] **Step 2: Escribir el test de SidebarIntegrationItems (falla)**

```tsx
// src/__tests__/components/SidebarIntegrationItems.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SidebarIntegrationItems } from '../../components/SidebarIntegrationItems'

describe('SidebarIntegrationItems', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: Window }).window.plugins = {
      list: vi.fn(() => Promise.resolve([{ pluginId: 'demo', scope: 'personal', enabled: true, config: {} }] as never)),
      save: vi.fn(), delete: vi.fn(),
    } as never
  })

  it('muestra las integraciones instaladas con adapter y notifica el click', async () => {
    const onOpen = vi.fn()
    render(<SidebarIntegrationItems onOpen={onOpen} />)
    await waitFor(() => screen.getByText('Demo'))
    fireEvent.click(screen.getByText('Demo'))
    expect(onOpen).toHaveBeenCalledWith('demo')
  })
})
```

Run: `npx vitest run src/__tests__/components/SidebarIntegrationItems.test.tsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar SidebarIntegrationItems**

```tsx
// src/components/SidebarIntegrationItems.tsx
// Integraciones instaladas promovidas a ítems del menú (spec §2).
// Solo muestra las que tienen adapter registrado (hito 1: 'demo').
import { useInstalledPlugins } from '../hooks/useInstalledPlugins'
import { BUILTIN_CATALOG } from '../lib/plugins/builtinCatalog'
import { hasAdapter } from '../integrations/registry'

export function SidebarIntegrationItems({ onOpen }: { onOpen: (pluginId: string) => void }) {
  const { installed } = useInstalledPlugins()
  const items = installed.filter((p) => p.enabled && hasAdapter(p.pluginId))
  if (items.length === 0) return null
  return (
    <>
      {items.map((p) => {
        const manifest = BUILTIN_CATALOG.find((m) => m.id === p.pluginId)
        return (
          <div key={p.pluginId} className="sidebar-item sidebar-item-panel" style={{ cursor: 'pointer' }}
            onClick={() => onOpen(p.pluginId)} title={manifest?.name ?? p.pluginId}>
            <span className="sidebar-icon" style={{ color: manifest?.color }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5.5 8h5M8 5.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">{manifest?.name ?? p.pluginId}</span>
          </div>
        )
      })}
    </>
  )
}
```

Nota: copiar las clases del ítem exactamente como las usa el ítem "Integraciones" existente en `Sidebar.tsx` (~línea 597). Si `sidebar-label` no existe ahí, usar el mismo markup del label que usan los ítems vecinos.

Run: `npx vitest run src/__tests__/components/SidebarIntegrationItems.test.tsx`
Expected: PASS

- [ ] **Step 4: Implementar IntegrationPanelHost**

```tsx
// src/components/IntegrationPanel/IntegrationPanelHost.tsx
// Overlay que monta el shell con el adapter del plugin (misma mecánica que IntegrationsMarketplace).
import { useMemo } from 'react'
import { getAdapter } from '../../integrations/registry'
import { IntegrationPanelShell } from './IntegrationPanelShell'
import { useGitInfo } from '../../hooks/useGitInfo'

interface Props {
  pluginId: string
  repoPath: string | null
  onClose: () => void
}

export function IntegrationPanelHost({ pluginId, repoPath, onClose }: Props) {
  const adapter = useMemo(() => getAdapter(pluginId), [pluginId])
  const { branch } = useGitInfo(repoPath ?? '')
  if (!adapter) return null
  return (
    <div className="ip-overlay" onClick={onClose}>
      <div className="ip-window" role="dialog" aria-label={adapter.displayName} onClick={(e) => e.stopPropagation()}>
        <div className="ip-window-bar">
          {adapter.displayName}
          <button className="ip-window-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <IntegrationPanelShell
          adapter={adapter}
          worktreeContext={{ repoPath, branch: branch ?? null }}
          getTerminalOutput={() => '$ (hito 2: output real del pane activo)'}
        />
      </div>
    </div>
  )
}
```

Nota: verificar la firma real de `useGitInfo` en `src/hooks/useGitInfo.ts` (en `Sidebar.tsx:72` se usa `useGitInfo(repoPath)` y devuelve `{ branch }`). Ajustar el tipo del argumento si acepta `string | null` directamente.
Nota: el `getTerminalOutput` es fake a propósito en este hito — la captura real del buffer del pane llega en el hito 2 (Slack).

- [ ] **Step 5: Wiring en Sidebar y App**

En `src/components/Sidebar.tsx`:
1. Agregar prop `onIntegrationPanelOpen?: (pluginId: string) => void` a `Props` (junto a `onIntegrationsOpen`, línea ~60) y al destructuring (~línea 70).
2. Importar `import { SidebarIntegrationItems } from './SidebarIntegrationItems'`.
3. Renderizar `<SidebarIntegrationItems onOpen={(id) => onIntegrationPanelOpen?.(id)} />` inmediatamente ANTES del `div` del ítem "Integraciones" (~línea 597), para que las instaladas queden arriba del "+".

En `src/App.tsx`:
1. Importar: `import { IntegrationPanelHost } from './components/IntegrationPanel/IntegrationPanelHost'`.
2. Estado (junto a `integrationsOpen`, línea ~196): `const [integrationPanelId, setIntegrationPanelId] = useState<string | null>(null)`.
3. Prop al `<Sidebar>` (junto a `onIntegrationsOpen`, línea ~1053): `onIntegrationPanelOpen={(id) => setIntegrationPanelId(id)}`.
4. Overlay (junto al bloque `integrationsOpen`, línea ~1220):

```tsx
      {integrationPanelId && (
        <IntegrationPanelHost
          pluginId={integrationPanelId}
          repoPath={activeTab.repoPath ?? null}
          onClose={() => setIntegrationPanelId(null)}
        />
      )}
```

- [ ] **Step 6: Correr TODA la suite y el build**

Run: `npm test && npm run build`
Expected: todos los tests pasan (la falla pre-existente conocida `worktrees-tutorial-button`/supabaseUrl no cuenta como regresión); build OK.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plugins/builtinCatalog.ts src/components/SidebarIntegrationItems.tsx src/components/IntegrationPanel/IntegrationPanelHost.tsx src/components/Sidebar.tsx src/App.tsx src/__tests__/components/SidebarIntegrationItems.test.tsx
git commit -m "feat(integrations): plugin Demo + promoción a ítem de Sidebar + host del panel (hito 1)"
```

---

### Task 7: Smoke manual con `npm run dev`

**Files:** ninguno (verificación).

- [ ] **Step 1: Levantar la app**

Run: `npm run dev`
Expected: la app abre sin errores en consola del main ni del renderer.

- [ ] **Step 2: Recorrido completo**

1. Click en el ítem "Integraciones" de la Sidebar → abre el marketplace.
2. Instalar "Demo" (tab Personal).
3. Cerrar el modal → aparece el ítem **Demo** en la Sidebar.
4. Click en Demo → abre el panel: columna izquierda con "Worktree actual → DEMO-231" (si hay repo con branch activo), secciones "Mi trabajo" y "Recientes".
5. El detalle de DEMO-231 carga solo (entidad resuelta del branch). Click en "→ Done" → el status cambia.
6. Escribir un comentario + "Adjuntar output del terminal" + Enviar → el comentario aparece en el detalle con el bloque de código.
7. Cerrar y reabrir el panel → las secciones cargan de nuevo (el estado mock se resetea al recargar la app: esperado).
8. Desinstalar Demo desde el marketplace → el ítem desaparece de la Sidebar.

- [ ] **Step 3: Commit final del hito (si hubo fixes)**

```bash
git add -A && git commit -m "fix(integrations): ajustes del smoke del hito 1"
```

---

## Qué NO entra en este hito (spec §8)

- OAuth real, Edge Functions, tokens (hito 2 con Slack).
- Fetch en main process / IPC `plugins:panel:*` (hito 2 — el contrato `IntegrationAdapter` ya lo permite).
- Captura real del output del terminal (hito 2).
- Gate Pro server-side (hito 5; el plugin Demo es tier free a propósito).
- Vista embebida en Teams/My Repos con sidebar persistente (los mockups la muestran; hito 1 usa overlay tipo modal por simplicidad de wiring — la migración de host es un cambio de montaje, no del shell).
