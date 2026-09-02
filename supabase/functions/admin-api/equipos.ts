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

export type Veredicto = { ok: true } | { ok: false; status: number; error: string }

/** Los candidatos reales a dueño: activos, con cuenta viva, y que no sean el dueño actual. */
function candidatos(equipo: Equipo): MiembroEquipo[] {
  return equipo.miembros.filter(
    (m) => m.status === 'active' && m.user_id !== null && m.user_id !== equipo.dueno.id,
  )
}

/**
 * ¿Se puede sacar esta fila de `team_members`?
 *
 * Vale igual para un miembro activo y para una invitación pendiente: son la
 * misma fila. Lo único que no se puede sacar es al dueño, porque dejaría el
 * equipo con un `owner_id` que ya no está entre sus miembros.
 */
export function validarSacarMiembro(equipo: Equipo, memberId: string): Veredicto {
  const miembro = equipo.miembros.find((m) => m.id === memberId)
  if (!miembro) {
    return { ok: false, status: 404, error: 'Ese miembro no pertenece a este equipo' }
  }
  if (miembro.es_dueno) {
    return {
      ok: false,
      status: 409,
      error: 'No se puede sacar al dueño del equipo. Transferí la propiedad primero.',
    }
  }
  return { ok: true }
}

/**
 * ¿Se le puede pasar la propiedad del equipo a `nuevoOwnerId`?
 *
 * El orden importa: primero "no hay a quién transferirle" (409) y después "a
 * ese no" (400). Sin candidatos el problema no es el id que mandaron, y la UI
 * necesita saber que el camino entero está cerrado en vez de invitar a probar
 * con otro.
 */
export function validarTransferencia(equipo: Equipo, nuevoOwnerId: string): Veredicto {
  if (candidatos(equipo).length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'El equipo no tiene otro miembro activo al que transferirle la propiedad',
    }
  }
  if (nuevoOwnerId === equipo.dueno.id) {
    return { ok: false, status: 400, error: 'Esa persona ya es la dueña del equipo' }
  }
  if (!candidatos(equipo).some((m) => m.user_id === nuevoOwnerId)) {
    return {
      ok: false,
      status: 400,
      error: 'El nuevo dueño tiene que ser miembro activo del equipo',
    }
  }
  return { ok: true }
}
