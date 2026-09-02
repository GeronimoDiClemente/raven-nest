/** Filas crudas, tal como salen de las tablas. */
export interface FilaTeam {
  id: string
  name: string | null
  owner_id: string
  created_at: string | null
}

export interface FilaMiembro {
  id: string
  team_id: string
  /** `null` cuando la cuenta se borró: la FK es ON DELETE SET NULL. */
  user_id: string | null
  email: string | null
  role: string | null
  status: string | null
  invited_at: string | null
  accepted_at: string | null
}

export interface FilaRepo {
  team_id: string
  repo_full_name: string
  provider: string | null
  added_at: string | null
}

export interface MiembroEquipo {
  /** Id de la fila de `team_members` — es lo que se manda para sacarlo. */
  id: string
  user_id: string | null
  email: string | null
  role: 'leader' | 'member'
  status: 'active' | 'pending'
  es_dueno: boolean
  invitado: string | null
  acepto: string | null
}

export interface RepoEquipo {
  full_name: string
  provider: string | null
  agregado: string | null
}

export interface Equipo {
  id: string
  name: string
  creado: string | null
  /** El usuario de la ficha es `teams.owner_id` de este equipo. */
  es_dueno: boolean
  dueno: { id: string; email: string | null }
  miembros: MiembroEquipo[]
  repos: RepoEquipo[]
  /** Conteo, nunca el contenido de los mensajes. */
  mensajes: number
}

/**
 * Arma los equipos de un usuario a partir de las filas crudas.
 *
 * La propiedad la define **`teams.owner_id`**, no `team_members.role`: en
 * producción hay equipos con cuatro miembros marcados `leader` y un solo
 * dueño, así que mirar el role para decidir quién manda da la respuesta
 * equivocada en la mayoría de los equipos reales.
 *
 * El email del dueño sale de su propia fila de `team_members`. Cuando no
 * existe —los equipos que nunca tuvieron miembros— queda en `null` en vez de
 * disparar una consulta a `auth.users` por un dato decorativo.
 */
export function aEquipos(
  usuarioId: string,
  teams: FilaTeam[],
  miembros: FilaMiembro[],
  repos: FilaRepo[],
  mensajesPorEquipo: Record<string, number>,
): Equipo[] {
  const ordenados = [...teams].sort((a, b) => {
    const propioA = a.owner_id === usuarioId ? 0 : 1
    const propioB = b.owner_id === usuarioId ? 0 : 1
    if (propioA !== propioB) return propioA - propioB
    return (a.name ?? '').localeCompare(b.name ?? '')
  })

  return ordenados.map((t) => {
    const delEquipo = miembros.filter((m) => m.team_id === t.id)
    const filaDueno = delEquipo.find((m) => m.user_id === t.owner_id)

    return {
      id: t.id,
      name: t.name ?? '(sin nombre)',
      creado: t.created_at,
      es_dueno: t.owner_id === usuarioId,
      dueno: { id: t.owner_id, email: filaDueno?.email ?? null },
      miembros: delEquipo.map((m) => ({
        id: m.id,
        user_id: m.user_id,
        email: m.email,
        role: m.role === 'leader' ? 'leader' : 'member',
        // Sin status explícito la fila es una invitación que nadie aceptó:
        // tratarla como activa la haría contar como seat ocupado.
        status: m.status === 'active' ? 'active' : 'pending',
        es_dueno: m.user_id !== null && m.user_id === t.owner_id,
        invitado: m.invited_at,
        acepto: m.accepted_at,
      })),
      repos: repos
        .filter((r) => r.team_id === t.id)
        .map((r) => ({
          full_name: r.repo_full_name,
          provider: r.provider,
          agregado: r.added_at,
        })),
      mensajes: mensajesPorEquipo[t.id] ?? 0,
    }
  })
}
