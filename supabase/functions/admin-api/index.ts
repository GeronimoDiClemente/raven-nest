// Edge Function — contrato /api/internal/* que consume el back-office.
// Deploy: supabase functions deploy admin-api
// Secrets: supabase secrets set NEST_ADMIN_API_TOKEN=<32+ chars>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { verificarAuth, type Actor } from './auth.ts'
import { rutaDe } from './router.ts'
import { MANIFEST } from './manifest.ts'
import { aAccountDetail, aAccountSummary, type UsuarioAuth } from './mapear.ts'
import { PLANES_VALIDOS, aSubResumen, elegirSub, esSubViva, type SubResumen } from './pricing.ts'
import { paginarTodo } from './paginar.ts'
import {
  aEquipos, validarSacarMiembro, validarTransferencia,
  type Equipo, type FilaMiembro, type FilaRepo, type FilaTeam,
} from './equipos.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-11-20.acacia',
  httpClient: Stripe.createFetchHttpClient(),
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const NO_PERMITIDO = () => json({ error: 'Metodo no permitido' }, 405)

/**
 * 200 en vez de los 1000 que pedía la versión vieja: GoTrue no respeta un
 * `perPage` grande (el bug del 2026-08-28 nació de ahí), así que se pide un
 * número modesto y se pagina de verdad con `paginarTodo` en vez de confiar en
 * que una sola llamada alcance.
 */
const PER_PAGE_USUARIOS = 200

/**
 * Tope de seguridad: 50 páginas x 200 = 10.000 usuarios. Muy por encima de lo
 * que tiene Nest hoy: si algún día se alcanza, es una señal real de que algo
 * anda mal (o de que el producto creció mucho), no un límite arbitrario que
 * se vaya a pisar por accidente.
 */
const MAX_PAGINAS_USUARIOS = 50

/**
 * `admin_audit_log.target_id` es `uuid NOT NULL`.
 *
 * Un id que no tenga forma de uuid hace fallar el insert **siempre**, así que
 * se chequea antes: mandar a la base una escritura que ya sabemos que rebota
 * sólo ensucia los logs. Los ids del contrato salen del path, que acepta
 * cualquier cosa (`/api/internal/accounts/pepito`).
 */
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El audit se escribe también cuando la acción falla.
 *
 * Devuelve **si la fila quedó escrita**. El invariante del contrato es que
 * toda escritura queda auditada con actor y motivo, y el modo de falla más
 * probable es deployar la función antes de correr la migración
 * `20260828000000_admin_audit_actor.sql`: ahí el insert rebota por columnas
 * inexistentes mientras `PUT /plan` y `DELETE` responden 200 perfectos, sin
 * dejar una sola fila de auditoría y con la única señal en logs que nadie
 * mira. Por eso el resultado viaja hasta el body de la respuesta.
 *
 * No hace rollback de la acción: ya ocurrió y ocultarla sería peor.
 */
/**
 * Busca un usuario distinguiendo "no existe" de "no pude preguntar".
 *
 * `getUserById` devuelve un **error** cuando el id no existe, no un `user`
 * nulo. Chequear `error` a secas —como hacía cada call site— convierte una
 * cuenta inexistente en un 500, y el back-office dice "Nest no responde"
 * cuando lo cierto es "esa cuenta no está". Verificado en el smoke del
 * 2026-08-28 contra producción: un uuid válido inexistente daba 500.
 *
 * GoTrue marca ese caso con `status: 404`; cualquier otro error sí es un
 * fallo real y tiene que seguir siendo 500.
 */
async function buscarUsuario(
  id: string,
): Promise<
  | { estado: 'ok'; user: { id: string; email: string | null; created_at: string } }
  | { estado: 'no_encontrado' }
  | { estado: 'error'; detalle: string }
> {
  const { data, error } = await admin.auth.admin.getUserById(id)
  if (error) {
    const status = (error as { status?: number }).status
    if (status === 404) return { estado: 'no_encontrado' }
    return { estado: 'error', detalle: error.message }
  }
  if (!data?.user) return { estado: 'no_encontrado' }
  return {
    estado: 'ok',
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
      created_at: data.user.created_at,
    },
  }
}

const COLUMNAS_MIEMBRO = 'id, team_id, user_id, email, role, status, invited_at, accepted_at'

/**
 * Los equipos donde el usuario es dueño **o** miembro, con todo lo que la
 * ficha muestra.
 *
 * Dos consultas separadas en vez de un `.or()` con el id interpolado: el id
 * viene del path y arma el filtro de PostgREST como texto. `.eq()` y `.in()`
 * lo mandan como parámetro.
 */
async function leerEquipos(usuarioId: string): Promise<Equipo[]> {
  const { data: membresías, error: errMembresías } = await admin
    .from('team_members').select('team_id').eq('user_id', usuarioId)
  if (errMembresías) {
    console.error('[admin-api] leerEquipos: fallo al leer las membresías del usuario', {
      usuarioId, error: errMembresías.message,
    })
    throw new Error('No se pudieron leer los equipos')
  }
  const idsPorMembresía = [...new Set((membresías ?? []).map((m) => m.team_id as string))]

  const columnas = 'id, name, owner_id, created_at'
  const { data: propios, error: errPropios } = await admin
    .from('teams').select(columnas).eq('owner_id', usuarioId)
  if (errPropios) {
    console.error('[admin-api] leerEquipos: fallo al leer los equipos propios', {
      usuarioId, error: errPropios.message,
    })
    throw new Error('No se pudieron leer los equipos')
  }
  // Sin ids no se consulta: `.in('id', [])` arma un filtro vacío y no vale la
  // pena averiguar cómo lo interpreta PostgREST.
  let ajenos: FilaTeam[] = []
  if (idsPorMembresía.length) {
    const { data, error: errAjenos } = await admin.from('teams').select(columnas).in('id', idsPorMembresía)
    if (errAjenos) {
      console.error('[admin-api] leerEquipos: fallo al leer los equipos ajenos', {
        usuarioId, error: errAjenos.message,
      })
      throw new Error('No se pudieron leer los equipos')
    }
    ajenos = (data ?? []) as FilaTeam[]
  }

  const porId = new Map<string, FilaTeam>()
  for (const t of [...(propios ?? []), ...ajenos] as FilaTeam[]) {
    porId.set(t.id, t)
  }
  const teams = [...porId.values()]
  if (teams.length === 0) return []

  const ids = teams.map((t) => t.id)
  const [miembros, repos, mensajes] = await Promise.all([
    admin.from('team_members').select(COLUMNAS_MIEMBRO).in('team_id', ids),
    // `local_path` es de la máquina de cada uno y no se expone.
    admin.from('team_repos').select('team_id, repo_full_name, provider, added_at').in('team_id', ids),
    // Conteo por equipo con `head: true`: nunca trae el contenido de un
    // mensaje. A diferencia de las cinco consultas de arriba, éste es un dato
    // decorativo —igual que el último uso en `actividadPorUsuario`—: un
    // fallo acá degrada a 0 en vez de tumbar toda la ficha por un contador.
    Promise.all(
      ids.map(async (id) => {
        const { count, error: errMensajes } = await admin
          .from('team_chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', id)
        if (errMensajes) {
          console.error('[admin-api] leerEquipos: fallo al contar los mensajes del equipo', {
            teamId: id, error: errMensajes.message,
          })
        }
        return [id, count ?? 0] as const
      }),
    ),
  ])
  if (miembros.error) {
    console.error('[admin-api] leerEquipos: fallo al leer los miembros', {
      usuarioId, error: miembros.error.message,
    })
    throw new Error('No se pudieron leer los equipos')
  }
  if (repos.error) {
    console.error('[admin-api] leerEquipos: fallo al leer los repos', {
      usuarioId, error: repos.error.message,
    })
    throw new Error('No se pudieron leer los equipos')
  }

  return aEquipos(
    usuarioId,
    teams,
    (miembros.data ?? []) as FilaMiembro[],
    (repos.data ?? []) as FilaRepo[],
    Object.fromEntries(mensajes),
  )
}

async function auditar(
  actor: Actor,
  action: string,
  /**
   * Qué clase de objeto se tocó. Las acciones de equipos apuntan a un equipo,
   * no a un usuario, y `target_type` es la única columna que lo distingue:
   * sin esto una transferencia quedaría registrada como si el objetivo fuera
   * una cuenta con un uuid que no existe en `auth.users`.
   */
  targetType: 'user' | 'team',
  targetId: string,
  targetLabel: string | null,
  before: unknown,
  after: unknown,
  ok: boolean,
  error: string | null,
): Promise<boolean> {
  if (!ES_UUID.test(targetId)) {
    console.error('[admin-api] audit omitido: target_id no es un uuid', {
      action, targetId, actor: actor.id,
    })
    return false
  }

  const { error: errorAudit } = await admin.from('admin_audit_log').insert({
    action,
    target_type: targetType,
    target_id: targetId,
    target_label: targetLabel,
    before,
    after,
    actor: actor.id,
    actor_email: actor.email,
    motivo: actor.motivo,
    ok,
    error,
  })
  if (errorAudit) {
    console.error('[admin-api] fallo al escribir el audit log', {
      action, targetId, actor: actor.id, error: errorAudit.message,
    })
    return false
  }
  return true
}

/**
 * Todas las suscripciones, indexadas por customer.
 *
 * Una llamada paginada en vez de una por cuenta: con 82 usuarios, pedirlas de
 * a una son 82 round-trips en cada carga de la lista.
 *
 * `status: 'all'` y la misma regla de desempate que `subDe`, a propósito: con
 * criterios distintos, un customer con una cancelada reciente y una activa
 * vieja salía `canceled` en la lista y `active` en la ficha — dos pantallas
 * con dos verdades sobre la misma cuenta.
 */
async function todasLasSubs(): Promise<Map<string, SubResumen>> {
  const porCustomer = new Map<string, SubResumen>()
  for await (const s of stripe.subscriptions.list({ limit: 100, status: 'all' })) {
    const cus = typeof s.customer === 'string' ? s.customer : s.customer?.id
    if (!cus) continue
    const candidata = aSubResumen(s)
    const actual = porCustomer.get(cus)
    // `list` viene por fecha de creación desc: la primera es la más reciente y
    // sólo la desplaza una viva cuando la que está no lo es.
    if (!actual || (!esSubViva(actual) && esSubViva(candidata))) {
      porCustomer.set(cus, candidata)
    }
  }
  return porCustomer
}

/** Trae la suscripción de un customer. `null` si no tiene; tira si Stripe falla. */
async function subDe(customerId: string | null): Promise<SubResumen | null> {
  if (!customerId) return null
  // `status: 'all'` + `limit: 100` para mirar lo mismo que la lista. Con el
  // default de Stripe ("todas menos las canceladas") y `limit: 1`, la ficha
  // veía un universo distinto al de la lista.
  const subs = await stripe.subscriptions.list({
    customer: customerId, status: 'all', limit: 100,
  })
  return elegirSub(subs.data.map(aSubResumen))
}

/**
 * `user_last_activity.last_refresh_at` de una o todas las cuentas.
 *
 * Degrada a vacío en vez de tumbar la respuesta: la vista vive fuera de las
 * migraciones de este repo (viene de raven-admin), así que que no esté es un
 * escenario real, y el último uso es contexto, no la identidad de la cuenta.
 */
async function actividadPorUsuario(userId?: string): Promise<Map<string, string | null>> {
  const porUsuario = new Map<string, string | null>()
  let q = admin.from('user_last_activity').select('user_id, last_refresh_at')
  if (userId) q = q.eq('user_id', userId)
  const { data, error } = await q
  if (error) {
    console.error('[admin-api] no se pudo leer user_last_activity', {
      userId: userId ?? null, error: error.message,
    })
    return porUsuario
  }
  for (const fila of data ?? []) {
    porUsuario.set(fila.user_id, fila.last_refresh_at ?? null)
  }
  return porUsuario
}

/**
 * Todos los usuarios de `auth.users`, paginando de verdad.
 *
 * `listUsers` no trae "todos" con una sola llamada aunque se le pida un
 * `perPage` grande: es exactamente el bug del 2026-08-28, donde una sola
 * llamada con `perPage: 1000` devolvía 80 cuentas de 82 reales sin ningún
 * aviso. `paginarTodo` (módulo puro, testeado sin red en
 * `__tests__/paginar.test.ts`) pide páginas sucesivas hasta que una vuelve
 * vacía o incompleta — la única señal de "se acabó" que no depende del
 * header `link` ni de `total`, que GoTrue no siempre manda.
 *
 * Un error de GoTrue en cualquier página tira: no tiene sentido mostrar un
 * subconjunto parcial de cuentas como si fuera la lista completa.
 */
async function todosLosUsuarios(): Promise<
  { users: UsuarioAuth[]; truncado: boolean; error: string | null }
> {
  try {
    const { items, truncado } = await paginarTodo<UsuarioAuth>(async (page) => {
      const { data, error } = await admin.auth.admin.listUsers({
        page, perPage: PER_PAGE_USUARIOS,
      })
      if (error) throw error
      return (data?.users ?? []).map((u) => (
        { id: u.id, email: u.email ?? null, created_at: u.created_at }
      ))
    }, PER_PAGE_USUARIOS, MAX_PAGINAS_USUARIOS)

    if (truncado) {
      console.error('[admin-api] listUsers alcanzo el tope de paginas de seguridad', {
        maxPaginas: MAX_PAGINAS_USUARIOS, perPage: PER_PAGE_USUARIOS, devueltos: items.length,
      })
    }
    return { users: items, truncado, error: null }
  } catch (e) {
    return {
      users: [], truncado: false,
      error: e instanceof Error ? e.message : 'Error desconocido al listar usuarios',
    }
  }
}

Deno.serve(async (req) => {
  const ruta = rutaDe(new URL(req.url).pathname)
  if (!ruta) return json({ error: 'No encontrado' }, 404)

  const esEscritura = req.method !== 'GET'
  const auth = verificarAuth(
    req.headers,
    Deno.env.get('NEST_ADMIN_API_TOKEN'),
    esEscritura,
  )
  if (!auth.ok) return json({ error: auth.error }, auth.status)
  const { actor } = auth

  try {
    // Las dos rutas sin id son de sólo lectura. Sin este guard, un
    // `DELETE /api/internal/accounts` corría el handler de lectura y devolvía
    // `200 {accounts:[...]}`, que un cliente puede leer como "borrado".
    if (ruta.nombre === 'manifest') {
      if (req.method !== 'GET') return NO_PERMITIDO()
      return json(MANIFEST)
    }

    if (ruta.nombre === 'accounts') {
      if (req.method !== 'GET') return NO_PERMITIDO()

      const [
        { users: usuarios, truncado, error: errUsuarios },
        { data: perfiles, error: errPerfiles },
        actividad,
      ] = await Promise.all([
        todosLosUsuarios(),
        admin.from('profiles').select('id, plan, stripe_customer_id, trial_started_at'),
        actividadPorUsuario(),
      ])
      // Sin esto, un fallo de auth o de la base devuelve `data` vacío sin
      // tirar: una lista vacía se vería idéntica a "no hay usuarios".
      if (errUsuarios || errPerfiles) {
        return json({ error: 'No se pudo leer la lista de cuentas' }, 500)
      }
      const porId = new Map((perfiles ?? []).map((p) => [p.id, p]))

      // Una llamada paginada, no una por cuenta: sin esto la columna de estado
      // diría "sin_suscripcion" para todos, incluidos los que pagan.
      let subs = new Map<string, SubResumen>()
      try {
        subs = await todasLasSubs()
      } catch {
        // Stripe caído no vacía la lista: los datos de la base valen igual.
      }

      const cuentas = usuarios.map((u) => {
        const perfil = porId.get(u.id) ?? null
        const cus = perfil?.stripe_customer_id ?? null
        return aAccountSummary(
          u,
          perfil,
          cus ? subs.get(cus) ?? null : null,
          actividad.get(u.id) ?? null,
        )
      })
      return json({ accounts: cuentas, truncado })
    }

    if (ruta.nombre === 'equipo_miembro') {
      if (req.method !== 'DELETE') return NO_PERMITIDO()
      const teamId = ruta.teamId!

      const { data: fila, error: errEquipo } = await admin
        .from('teams').select('id, name, owner_id, created_at').eq('id', teamId).maybeSingle()
      if (errEquipo) return json({ error: 'No se pudo leer el equipo' }, 500)
      if (!fila) {
        await auditar(actor, 'team_member_removed', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      // Se arman los equipos desde la perspectiva del dueño: alcanza para
      // decidir, y evita pedir el usuario de la ficha que acá no viaja.
      const equipos = await leerEquipos(fila.owner_id as string)
      const equipo = equipos.find((e) => e.id === teamId)
      if (!equipo) {
        await auditar(actor, 'team_member_removed', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      const veredicto = validarSacarMiembro(equipo, ruta.memberId!)
      if (!veredicto.ok) {
        await auditar(actor, 'team_member_removed', 'team', teamId, equipo.name, null, null,
          false, veredicto.error)
        return json({ error: veredicto.error }, veredicto.status)
      }

      const sacado = equipo.miembros.find((m) => m.id === ruta.memberId)!
      const { error } = await admin.from('team_members').delete().eq('id', ruta.memberId!)

      const auditado = await auditar(
        actor, 'team_member_removed', 'team', teamId, equipo.name,
        { miembro: sacado.email, role: sacado.role, status: sacado.status }, null,
        !error, error?.message ?? null,
      )
      if (error) return json({ error: error.message }, 500)

      const actualizado = (await leerEquipos(fila.owner_id as string)).find((e) => e.id === teamId)
      // Si el equipo desaparecio entre el delete y esta relectura, la accion
      // ya ocurrio y ya quedo auditada: informar un error mentiria. Se deja
      // `null` explicito (en vez de dejar que `JSON.stringify` descarte la
      // clave) para que el cliente pueda distinguir "sin equipo" de "no vino
      // el campo".
      if (!actualizado) {
        console.error('[admin-api] el equipo desaparecio entre el delete y la relectura', { teamId })
      }
      return json({ equipo: actualizado ?? null, ...(auditado ? {} : { auditado: false }) })
    }

    if (ruta.nombre === 'equipo_owner') {
      if (req.method !== 'PUT') return NO_PERMITIDO()
      const teamId = ruta.teamId!

      const { data: fila, error: errEquipo } = await admin
        .from('teams').select('id, name, owner_id, created_at').eq('id', teamId).maybeSingle()
      if (errEquipo) return json({ error: 'No se pudo leer el equipo' }, 500)
      if (!fila) {
        await auditar(actor, 'team_owner_transferred', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      const duenoViejo = fila.owner_id as string
      const equipo = (await leerEquipos(duenoViejo)).find((e) => e.id === teamId)
      if (!equipo) {
        // Mismo criterio que la rama de arriba: un rechazo sin rastro es el
        // agujero por donde no se ve quién intentó qué.
        await auditar(actor, 'team_owner_transferred', 'team', teamId, null, null, null,
          false, 'Equipo no encontrado')
        return json({ error: 'Equipo no encontrado' }, 404)
      }

      const body = await req.json().catch(() => null) as { owner_id?: string } | null
      const nuevo = body?.owner_id?.trim() ?? ''
      const veredicto = nuevo
        ? validarTransferencia(equipo, nuevo)
        : { ok: false as const, status: 400, error: 'Falta owner_id' }
      if (!veredicto.ok) {
        await auditar(actor, 'team_owner_transferred', 'team', teamId, equipo.name,
          { owner: duenoViejo }, { owner: nuevo || null }, false, veredicto.error)
        return json({ error: veredicto.error }, veredicto.status)
      }

      const { error } = await admin.from('teams').update({ owner_id: nuevo }).eq('id', teamId)
      if (error) {
        await auditar(actor, 'team_owner_transferred', 'team', teamId, equipo.name,
          { owner: duenoViejo }, { owner: nuevo }, false, error.message)
        return json({ error: error.message }, 500)
      }

      // El dueño nuevo pasa a `leader` si no lo era. El viejo NO se toca: sigue
      // siendo miembro, así la transferencia no le saca el acceso a nadie ni
      // cambia la cantidad de seats facturados.
      const { error: errRole } = await admin
        .from('team_members').update({ role: 'leader' })
        .eq('team_id', teamId).eq('user_id', nuevo)

      const auditado = await auditar(
        actor, 'team_owner_transferred', 'team', teamId, equipo.name,
        { owner: duenoViejo }, { owner: nuevo }, true,
        // La propiedad ya se movió; que el role no haya seguido es un aviso,
        // no un fallo de la acción.
        errRole ? `owner movido, role no actualizado: ${errRole.message}` : null,
      )

      const actualizado = (await leerEquipos(nuevo)).find((e) => e.id === teamId)
      if (!actualizado) {
        console.error('[admin-api] el equipo desaparecio entre la transferencia y la relectura',
          { teamId })
      }
      // `null` explícito, no un error ni `undefined`: la propiedad ya se movió y
      // quedó auditada, y `JSON.stringify` borraría la clave dejando al cliente
      // sin `equipo` y sin señal de por qué.
      return json({
        equipo: actualizado ?? null,
        cambios: [{ key: 'owner', de: duenoViejo, a: nuevo }],
        ...(auditado ? {} : { auditado: false }),
      })
    }

    const id = ruta.id!

    if (ruta.nombre === 'account' && req.method === 'GET') {
      const buscado = await buscarUsuario(id)
      if (buscado.estado === 'error') {
        console.error('[admin-api] getUserById fallo', { id, detalle: buscado.detalle })
        return json({ error: 'No se pudo verificar la cuenta' }, 500)
      }
      if (buscado.estado === 'no_encontrado') {
        return json({ error: 'Cuenta no encontrada' }, 404)
      }
      const authUser = { user: buscado.user }

      const [
        { data: perfil, error: errPerfil },
        { count: repos, error: errRepos },
        { count: teams, error: errTeams },
        actividad,
      ] = await Promise.all([
        admin.from('profiles')
          .select('plan, stripe_customer_id, trial_started_at').eq('id', id).maybeSingle(),
        admin.from('user_repos').select('id', { count: 'exact', head: true }).eq('user_id', id),
        // `status = 'active'` o el meter cuenta también invitaciones y pedidos
        // de join: alguien que pidió entrar a 3 equipos y no fue aprobado en
        // ninguno figuraba con "Equipos: 3".
        admin.from('team_members').select('team_id', { count: 'exact', head: true })
          .eq('user_id', id).eq('status', 'active'),
        actividadPorUsuario(id),
      ])
      // Un fallo acá no puede degradar en silencio a "plan free, salud ok":
      // sería el mismo diagnóstico falso que el caso de Stripe caído evita
      // del otro lado, entrando por la puerta del error ignorado.
      if (errPerfil || errRepos || errTeams) {
        return json({ error: 'No se pudo leer la ficha de la cuenta' }, 500)
      }

      // Stripe caído degrada la ficha, no la tumba: los datos de la base valen
      // igual, y "no disponible" no es lo mismo que "no paga".
      let sub: SubResumen | null = null
      let stripeCaido = false
      try {
        sub = await subDe(perfil?.stripe_customer_id ?? null)
      } catch {
        stripeCaido = true
      }

      return json(
        aAccountDetail(
          { id: authUser.user.id, email: authUser.user.email ?? null, created_at: authUser.user.created_at },
          perfil ?? null,
          sub,
          { repos: repos ?? 0, teams: teams ?? 0, seats: sub?.quantity ?? 0, stripeCaido },
          actividad.get(id) ?? null,
        ),
      )
    }

    if (ruta.nombre === 'plan' && req.method === 'PUT') {
      const buscadoPlan = await buscarUsuario(id)
      if (buscadoPlan.estado === 'error') {
        console.error('[admin-api] getUserById fallo', { id, detalle: buscadoPlan.detalle })
        return json({ error: 'No se pudo verificar la cuenta' }, 500)
      }
      // Una escritura contra un id inexistente se audita igual que el email de
      // confirmación que no coincide: es justo el patrón de alguien probando
      // ids, y era el único intento fallido que no dejaba rastro.
      if (buscadoPlan.estado === 'no_encontrado') {
        await auditar(actor, 'change_plan', 'user', id, null, null, null, false, 'Cuenta no encontrada')
        return json({ error: 'Cuenta no encontrada' }, 404)
      }
      const u = { user: buscadoPlan.user }
      const email = u.user.email ?? null

      const body = await req.json().catch(() => null) as { plan?: string } | null
      const plan = body?.plan
      if (!plan || !PLANES_VALIDOS.includes(plan as typeof PLANES_VALIDOS[number])) {
        const msg = `Plan invalido. Validos: ${PLANES_VALIDOS.join(', ')}`
        // Un intento fallido es información operativa igual que uno exitoso.
        await auditar(actor, 'change_plan', 'user', id, email, null, { plan: plan ?? null }, false, msg)
        return json({ error: msg }, 400)
      }

      const { data: antes, error: errAntes } = await admin.from('profiles')
        .select('plan').eq('id', id).maybeSingle()
      if (errAntes) return json({ error: 'No se pudo leer el plan actual' }, 500)

      // `.select()` en el update para distinguir "no matcheó ninguna fila"
      // (sin error, 0 filas) de "sí se actualizó": pasa cuando la cuenta
      // existe en auth.users pero no tiene fila en `profiles`.
      const { data: actualizados, error } = await admin.from('profiles')
        .update({ plan, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('plan')

      const sinFila = !error && (actualizados?.length ?? 0) === 0
      const ok = !error && !sinFila
      const mensaje = error?.message ?? (sinFila ? 'La cuenta no tiene perfil' : null)

      const auditado = await auditar(actor, 'change_plan', 'user', id, email,
        { plan: antes?.plan ?? null }, { plan }, ok, mensaje)

      if (error) return json({ error: error.message }, 500)
      if (sinFila) return json({ error: 'La cuenta no tiene perfil' }, 404)
      // El cambio se aplicó, así que no se esconde; pero tampoco se reporta
      // éxito limpio si nadie lo registró: `auditado: false` es el aviso de
      // que hay una escritura sin fila de auditoría.
      return json({
        cambios: [{ key: 'plan', de: antes?.plan ?? null, a: plan }],
        ...(auditado ? {} : { auditado: false }),
      })
    }

    if (ruta.nombre === 'equipos') {
      if (req.method !== 'GET') return NO_PERMITIDO()
      const buscado = await buscarUsuario(id)
      if (buscado.estado === 'error') {
        console.error('[admin-api] getUserById fallo', { id, detalle: buscado.detalle })
        return json({ error: 'No se pudo verificar la cuenta' }, 500)
      }
      // Es lectura: no se audita, igual que la ficha y la lista de cuentas.
      if (buscado.estado === 'no_encontrado') return json({ error: 'Cuenta no encontrada' }, 404)
      return json({ equipos: await leerEquipos(id) })
    }

    if (ruta.nombre === 'account' && req.method === 'DELETE') {
      const buscadoDel = await buscarUsuario(id)
      if (buscadoDel.estado === 'error') {
        console.error('[admin-api] getUserById fallo', { id, detalle: buscadoDel.detalle })
        return json({ error: 'No se pudo verificar la cuenta' }, 500)
      }
      if (buscadoDel.estado === 'no_encontrado') {
        await auditar(actor, 'delete_user', 'user', id, null, null, null, false, 'Cuenta no encontrada')
        return json({ error: 'Cuenta no encontrada' }, 404)
      }
      const u = { user: buscadoDel.user }
      const email = u.user.email ?? null

      const body = await req.json().catch(() => null) as { email_confirm?: string } | null
      const emailConfirm = (body?.email_confirm ?? '').trim()
      // Misma confirmación que pedía raven-admin: borrar es irreversible. Los
      // dos casos degenerados se rechazan explícitamente antes de comparar:
      // si la cuenta no tiene email, o si `email_confirm` viene vacío o
      // ausente, comparar contra `''` daría un match falso (`'' !== ''` es
      // `false`) y el borrado pasaría sin ninguna confirmación real.
      if (!email || !emailConfirm || emailConfirm.toLowerCase() !== email.toLowerCase()) {
        await auditar(actor, 'delete_user', 'user', id, email, null, null, false,
          'El email de confirmacion no coincide')
        return json({ error: 'El email de confirmacion no coincide' }, 400)
      }

      const { data: perfil, error: errPerfil } = await admin.from('profiles')
        .select('plan, stripe_customer_id').eq('id', id).maybeSingle()
      if (errPerfil) return json({ error: 'No se pudo leer el perfil' }, 500)

      // El audit registra nombres de campos, nunca valores sensibles:
      // `stripe_customer_id` no sale de acá, sólo si la cuenta tenía o no
      // facturación asociada.
      const teniaStripe = Boolean(perfil?.stripe_customer_id)
      const antes = perfil
        ? { plan: perfil.plan, tenia_stripe: teniaStripe }
        : null

      const { error } = await admin.auth.admin.deleteUser(id)

      const auditado = await auditar(actor, 'delete_user', 'user', id, email, antes, null,
        !error, error?.message ?? null)

      if (error) return json({ error: error.message }, 500)
      // Cancelar cobros está fuera de alcance del contrato, pero una vez
      // borrado el usuario **este es el único lugar que sabe** que tenía
      // `stripe_customer_id`. Sin este campo el panel daría la ilusión
      // contraria mientras Stripe le sigue cobrando a una cuenta que ya no
      // existe.
      return json({
        borrado: true,
        tenia_stripe: teniaStripe,
        ...(auditado ? {} : { auditado: false }),
      })
    }

    return NO_PERMITIDO()
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error interno'
    // El detalle va al log, no al cliente: las excepciones del SDK de Stripe
    // traen el sufijo de la key redactada y el request id. El audit sí guarda
    // el mensaje real, que es interno y lo lee staff.
    console.error('[admin-api] excepcion no anticipada', {
      ruta: ruta.nombre, id: ruta.id ?? null, actor: actor.id, error: mensaje,
    })
    if (esEscritura) {
      // `target_id` es `uuid NOT NULL`: sin id no hay insert posible. El que
      // había (`target_id: ''`) fallaba siempre, así que ni se intenta y
      // queda el `console.error` de arriba como único rastro.
      if (ruta.id) {
        try {
          await auditar(actor, `${ruta.nombre}_error`, 'user', ruta.id, null, null, null, false, mensaje)
        } catch {
          // Ya estamos en el peor camino: si tampoco se pudo auditar, no hay
          // más red de seguridad que devolver igual la respuesta al llamador.
        }
      } else {
        console.error('[admin-api] sin id: la excepcion no se pudo auditar', {
          ruta: ruta.nombre, actor: actor.id,
        })
      }
    }
    return json({ error: 'Error interno' }, 500)
  }
})
