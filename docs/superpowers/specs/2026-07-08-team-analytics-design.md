# Team Analytics — Design Spec
**Fecha:** 2026-07-08  
**Contexto:** Reunión con aceleradora que quiere usar Nest para 45 developers. Pidieron visibilidad de actividad por developer (quién hace más, qué hace, cuánto).

---

## Objetivo

Agregar una sección "Stats" dentro del `TeamsWorkspace` existente que muestre métricas de actividad por developer, usando datos que ya fluyen por el app (GitHub events + Supabase Presence). Sin migraciones nuevas de base de datos.

---

## Lo que se construye

### 1. Hook `useTeamStats.ts`

Agrega los eventos de GitHub (ya disponibles vía GitHub API) por developer y los combina con presence data.

**Input:**
- `events: GitHubEvent[]` — los mismos que ya usa `ActivityFeed`
- `presence: Record<string, PresenceState>` — del hook `useTeamPresence` ya existente
- `teamMembers: Array<{ email: string; user_id: string | null }>` — ya disponible en TeamsWorkspace

**Output por developer:**
```ts
interface DeveloperStats {
  login: string           // GitHub username
  avatarUrl: string
  isOnline: boolean       // de presence
  currentRepo: string | null   // de presence
  currentBranch: string | null // de presence
  lastSeen: string        // de presence
  commits: number         // PushEvents esta semana
  prsOpened: number       // PullRequestEvent opened
  prsMerged: number       // PullRequestEvent merged
  issuesClosed: number    // IssuesEvent closed
  lastEventAt: string     // último evento GitHub
}
```

**Lógica de matching:** los eventos GitHub incluyen `actor.login` y `actor.avatar_url`. Se agrupa por `actor.login` directamente — no se intenta hacer match con emails de teamMembers (que son Supabase IDs, no GitHub logins). El presence online/offline se muestra como un panel separado por displayName. En Fase 2, cuando se guarde el GitHub login en el perfil de Supabase, se puede hacer el merge completo.

### 2. Componente `TeamStats.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  OVERVIEW                                            │
│  [🟢 12 activos ahora] [📦 47 commits] [⬡ 8 PRs]  │
│  [🏆 top: @maticodes]                               │
├─────────────────────────────────────────────────────┤
│  DEVELOPERS                                          │
│  Avatar  Nombre    Estado  Repo/Branch  C   PR  Last │
│  ●       @alice    🟢      main-api/feat 12   3   2m │
│  ●       @bob      ⚫      —            4    1   3h  │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

- Ordenado por commits (descendente) por defecto
- Columnas: Avatar, login, estado online, repo+branch actual, commits semana, PRs, última actividad
- Estado 🟢 si está en presence actualmente, ⚫ si no
- Muestra "N/A" si el developer no tiene GitHub conectado

### 3. Integración en `TeamsWorkspace.tsx`

- Agregar `'stats'` al tipo `WorkspaceSection`
- Agregar botón "Stats" en la barra de navegación de secciones (junto a activity, chat, repos, etc.)
- Pasar `events` (del fetch de ActivityFeed) y `presence` al nuevo componente

---

## Lo que NO se construye en esta iteración

- Sesiones de IA por developer (requiere instrumentar PTY por usuario + tabla nueva)
- Tiempo en terminal (requiere persistent session tracking)
- Historial más allá de la semana (requiere DB nueva)
- Notificaciones de inactividad
- Exportar datos a CSV

Estas capacidades van en una Fase 2 post-reunión si el deal se cierra.

---

## Archivos a crear/modificar

| Archivo | Acción |
|---------|--------|
| `src/hooks/useTeamStats.ts` | Crear |
| `src/components/TeamStats.tsx` | Crear |
| `src/components/TeamsWorkspace.tsx` | Modificar — agregar sección 'stats' + nav tab |

---

## Criterio de éxito para la demo

En la reunión se puede mostrar en vivo:
1. La tabla de developers con quién está online ahora
2. Commits y PRs de la semana por developer
3. Ordenar por actividad y ver quién es el más productivo

Con 45 developers reales del cliente, el impacto visual es inmediato.
