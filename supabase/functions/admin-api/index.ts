// Edge Function — contrato /api/internal/* que consume el back-office.
// Deploy: supabase functions deploy admin-api
// Secrets: supabase secrets set NEST_ADMIN_API_TOKEN=<32+ chars>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { verificarAuth, type Actor } from './auth.ts'
import { rutaDe } from './router.ts'
import { MANIFEST } from './manifest.ts'
import { aAccountDetail, aAccountSummary } from './mapear.ts'
import { PLANES_VALIDOS, aSubResumen, type SubResumen } from './pricing.ts'

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

/** El audit se escribe también cuando la acción falla. */
async function auditar(
  actor: Actor,
  action: string,
  targetId: string,
  targetLabel: string | null,
  before: unknown,
  after: unknown,
  ok: boolean,
  error: string | null,
) {
  const { error: errorAudit } = await admin.from('admin_audit_log').insert({
    action,
    target_type: 'user',
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
  // Un audit que falla en silencio es el peor modo de falla para un contrato
  // cuya razón de ser es la auditabilidad. No cambia el status de la
  // respuesta: la acción de negocio ya ocurrió y ocultarla sería peor.
  if (errorAudit) {
    console.error('[admin-api] fallo al escribir el audit log', {
      action, targetId, actor: actor.id, error: errorAudit.message,
    })
  }
}

/**
 * Todas las suscripciones, indexadas por customer.
 *
 * Una llamada paginada en vez de una por cuenta: con 82 usuarios, pedirlas de
 * a una son 82 round-trips en cada carga de la lista.
 */
async function todasLasSubs(): Promise<Map<string, SubResumen>> {
  const porCustomer = new Map<string, SubResumen>()
  for await (const s of stripe.subscriptions.list({ limit: 100, status: 'all' })) {
    const cus = typeof s.customer === 'string' ? s.customer : s.customer?.id
    // La primera gana: `list` viene ordenada por fecha de creación desc.
    if (cus && !porCustomer.has(cus)) porCustomer.set(cus, aSubResumen(s))
  }
  return porCustomer
}

/** Trae la suscripción de un customer. `null` si no tiene; tira si Stripe falla. */
async function subDe(customerId: string | null): Promise<SubResumen | null> {
  if (!customerId) return null
  const subs = await stripe.subscriptions.list({ customer: customerId, limit: 1 })
  const s = subs.data[0]
  return s ? aSubResumen(s) : null
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
    if (ruta.nombre === 'manifest') return json(MANIFEST)

    if (ruta.nombre === 'accounts') {
      const [
        { data: usuarios, error: errUsuarios },
        { data: perfiles, error: errPerfiles },
      ] = await Promise.all([
        admin.auth.admin.listUsers({ perPage: 1000 }),
        admin.from('profiles').select('id, plan, stripe_customer_id, trial_started_at'),
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

      const cuentas = (usuarios?.users ?? []).map((u) => {
        const perfil = porId.get(u.id) ?? null
        const cus = perfil?.stripe_customer_id ?? null
        return aAccountSummary(
          { id: u.id, email: u.email ?? null, created_at: u.created_at },
          perfil,
          cus ? subs.get(cus) ?? null : null,
        )
      })
      return json({ accounts: cuentas })
    }

    const id = ruta.id!

    if (ruta.nombre === 'account' && req.method === 'GET') {
      const { data: authUser, error: errAuthUser } = await admin.auth.admin.getUserById(id)
      if (errAuthUser) return json({ error: 'No se pudo verificar la cuenta' }, 500)
      if (!authUser?.user) return json({ error: 'Cuenta no encontrada' }, 404)

      const [
        { data: perfil, error: errPerfil },
        { count: repos, error: errRepos },
        { count: teams, error: errTeams },
      ] = await Promise.all([
        admin.from('profiles')
          .select('plan, stripe_customer_id, trial_started_at').eq('id', id).maybeSingle(),
        admin.from('user_repos').select('id', { count: 'exact', head: true }).eq('user_id', id),
        admin.from('team_members').select('team_id', { count: 'exact', head: true }).eq('user_id', id),
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
        ),
      )
    }

    if (ruta.nombre === 'plan' && req.method === 'PUT') {
      const { data: u, error: errUsuario } = await admin.auth.admin.getUserById(id)
      if (errUsuario) return json({ error: 'No se pudo verificar la cuenta' }, 500)
      if (!u?.user) return json({ error: 'Cuenta no encontrada' }, 404)
      const email = u.user.email ?? null

      const body = await req.json().catch(() => null) as { plan?: string } | null
      const plan = body?.plan
      if (!plan || !PLANES_VALIDOS.includes(plan as typeof PLANES_VALIDOS[number])) {
        const msg = `Plan invalido. Validos: ${PLANES_VALIDOS.join(', ')}`
        // Un intento fallido es información operativa igual que uno exitoso.
        await auditar(actor, 'change_plan', id, email, null, { plan: plan ?? null }, false, msg)
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

      await auditar(actor, 'change_plan', id, email,
        { plan: antes?.plan ?? null }, { plan }, ok, mensaje)

      if (error) return json({ error: error.message }, 500)
      if (sinFila) return json({ error: 'La cuenta no tiene perfil' }, 404)
      return json({ cambios: [{ key: 'plan', de: antes?.plan ?? null, a: plan }] })
    }

    if (ruta.nombre === 'account' && req.method === 'DELETE') {
      const { data: u, error: errUsuario } = await admin.auth.admin.getUserById(id)
      if (errUsuario) return json({ error: 'No se pudo verificar la cuenta' }, 500)
      if (!u?.user) return json({ error: 'Cuenta no encontrada' }, 404)
      const email = u.user.email ?? null

      const body = await req.json().catch(() => null) as { email_confirm?: string } | null
      const emailConfirm = (body?.email_confirm ?? '').trim()
      // Misma confirmación que pedía raven-admin: borrar es irreversible. Los
      // dos casos degenerados se rechazan explícitamente antes de comparar:
      // si la cuenta no tiene email, o si `email_confirm` viene vacío o
      // ausente, comparar contra `''` daría un match falso (`'' !== ''` es
      // `false`) y el borrado pasaría sin ninguna confirmación real.
      if (!email || !emailConfirm || emailConfirm.toLowerCase() !== email.toLowerCase()) {
        await auditar(actor, 'delete_user', id, email, null, null, false,
          'El email de confirmacion no coincide')
        return json({ error: 'El email de confirmacion no coincide' }, 400)
      }

      const { data: perfil, error: errPerfil } = await admin.from('profiles')
        .select('plan, stripe_customer_id').eq('id', id).maybeSingle()
      if (errPerfil) return json({ error: 'No se pudo leer el perfil' }, 500)

      // El audit registra nombres de campos, nunca valores sensibles:
      // `stripe_customer_id` no sale de acá, sólo si la cuenta tenía o no
      // facturación asociada.
      const antes = perfil
        ? { plan: perfil.plan, tenia_stripe: Boolean(perfil.stripe_customer_id) }
        : null

      const { error } = await admin.auth.admin.deleteUser(id)

      await auditar(actor, 'delete_user', id, email, antes, null,
        !error, error?.message ?? null)

      if (error) return json({ error: error.message }, 500)
      return json({ borrado: true })
    }

    return json({ error: 'Metodo no permitido' }, 405)
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'Error interno'
    if (esEscritura) {
      // Un error no anticipado en una escritura es tan auditable como uno
      // anticipado: `ok: false` con lo que se sabe, sin inventar el resto.
      try {
        await auditar(actor, `${ruta.nombre}_error`, ruta.id ?? '', null, null, null, false, mensaje)
      } catch {
        // Ya estamos en el peor camino: si tampoco se pudo auditar, no hay
        // más red de seguridad que devolver igual la respuesta al llamador.
      }
    }
    return json({ error: mensaje }, 500)
  }
})
