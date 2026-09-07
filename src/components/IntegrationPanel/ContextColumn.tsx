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
            const on = selected?.sectionId === s.id && selected?.itemId === it.id
            return (
              <button key={it.id} className={`ip-item${on ? ' active' : ''}`} aria-pressed={on} onClick={() => onSelect(ref)}>
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
