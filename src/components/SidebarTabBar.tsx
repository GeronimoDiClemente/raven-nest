import type { ReactNode } from 'react'
import { Waypoints, Folder, Wrench, LayoutDashboard, type LucideIcon } from 'lucide-react'
import { ICON_SIZE } from '../lib/icons'

export type SidebarTabId = 'worktrees' | 'explorer' | 'tools' | 'hub'

interface Props {
  active: SidebarTabId
  onChange: (tab: SidebarTabId) => void
  /** Which tabs to show, in order. Hub mode swaps Worktrees for Hub; the
   *  normal repo sidebar takes the default. */
  tabs?: readonly SidebarTabId[]
  /** Rendered below the tabs, inside the same box — the repo row. Under the
   *  tabs and not above them: on top it reads as a separate block sitting
   *  over the menu. */
  footer?: ReactNode
}

// Iconos de lucide, no dibujados a mano: el tamano y el grosor los pone el contrato
// (src/lib/icons.ts + el LucideProvider de main.tsx), asi que aca no se inventa ninguno de
// los dos.
//
// `Waypoints` en vez de `GitBranch` para Worktrees: tres nodos unidos — un worktree ES una
// rama, y el mismo grafo aparece en el header del repo. GitBranch es otra silueta.
export const TAB_ICONS: Record<SidebarTabId, LucideIcon> = {
  worktrees: Waypoints,
  explorer: Folder,
  tools: Wrench,
  /**
   * `LayoutDashboard` y no `LayoutGrid`.
   *
   * El grid de cuatro cuadraditos iguales es la forma universal de "launcher de apps": la
   * usan iOS, Android y el menú de Google, y arrastra ese significado sin pedir permiso. El
   * Hub no es un cajón de aplicaciones — es un tablero con los workspaces que tenés abiertos,
   * de tamaños distintos. Los mosaicos asimétricos dicen "tablero"; los cuatro cuadrados
   * iguales dicen "elegí una app".
   */
  hub: LayoutDashboard,
}

export const TAB_LABELS: Record<SidebarTabId, string> = {
  worktrees: 'Worktrees',
  explorer: 'Explorer',
  tools: 'Tools',
  hub: 'Hub',
}

export const REPO_TABS = ['worktrees', 'explorer', 'tools'] as const
export const HUB_TABS = ['hub', 'explorer', 'tools'] as const

export default function SidebarTabBar({ active, onChange, tabs = REPO_TABS, footer }: Props) {
  return (
    <div className="sidebar-menu-box">
      <div className="sidebar-tabbar" role="tablist">
        {tabs.map((id) => ({ id, label: TAB_LABELS[id], Icon: TAB_ICONS[id] })).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`sidebar-tab${active === tab.id ? ' active' : ''}`}
            onClick={() => onChange(tab.id)}
            title={tab.label}
          >
            <span className="sidebar-tab-icon">
              <tab.Icon size={ICON_SIZE.lg} aria-hidden />
            </span>
            <span className="sidebar-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
      {footer}
    </div>
  )
}
