// Supabase Edge Function — Nest Memory sync: bootstrap / push / pull.
// Design: docs/nest-memory-architecture.md §4.2 (push), §4.4 (pull), §5.1 (bootstrap),
// §6.1/§6.4 (token resolution + epoch check).
// Deploy: supabase functions deploy memory-sync
//
// UNVERIFIED IN THIS ENVIRONMENT — see the header note in memory-token/index.ts; the
// same caveat applies here (no Docker/supabase CLI to `functions serve` locally).
//
// Authorized by Bearer nmk_… (NOT the user's Supabase JWT) — this is the "daemon path"
// distinguished from the dashboard/PostgREST path in §1.4. The token is resolved by hash
// to a user_id here; every authorization decision after that lives in the SECURITY
// DEFINER RPCs (memory_resolve_project, memory_sync_push, memory_sync_pull), reviewable
// in one SQL file (§4.2 preamble).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  // Routed as /functions/v1/memory-sync/{bootstrap|push|pull} per the client calls in
  // electron/memory-daemon.ts.
  const action = url.pathname.split('/').filter(Boolean).pop()

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const match = authHeader.match(/^Bearer\s+(nmk_\S+)$/)
    if (!match) return json({ error: 'Missing or invalid Bearer nmk_ token' }, 401)
    const token = match[1]
    const tokenHash = await sha256Hex(token)

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: tokenRow } = await serviceClient
      .from('memory_tokens')
      .select('id, user_id, device_id, revoked_at, expires_at, minted_epoch')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (!tokenRow) return json({ error: 'invalid_token' }, 401)
    if (tokenRow.revoked_at) return json({ error: 'revoked_token' }, 401)
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return json({ error: 'expired_token' }, 401)

    const { data: profile } = await serviceClient.from('profiles').select('memory_token_epoch, plan').eq('id', tokenRow.user_id).maybeSingle()
    if (profile && profile.memory_token_epoch !== tokenRow.minted_epoch) {
      // §6.4 hard-kill lever: a team-removal bump invalidates every token minted before it.
      return json({ error: 'stale_token_epoch' }, 401)
    }

    void serviceClient.from('memory_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tokenRow.id) // fire-and-forget

    const userId = tokenRow.user_id as string

    if (action === 'bootstrap') {
      const { data, error } = await serviceClient.rpc('memory_sync_bootstrap', { p_user_id: userId })
      if (error) throw error
      return json(data)
    }

    if (action === 'push') {
      const body = await req.json()
      const mutations = (body.mutations ?? []) as Array<{ payload: Record<string, unknown> }>
      // Group by the project_key each mutation's payload carries — a client batch can
      // span multiple projects; each group gets its own advisory-locked RPC call
      // (§4.2 "one call = one project's batch").
      const byProject = new Map<string, typeof mutations>()
      for (const m of mutations) {
        const key = (m.payload.project_key as string) ?? '__global__'
        if (!byProject.has(key)) byProject.set(key, [])
        byProject.get(key)!.push(m)
      }

      const allResults: unknown[] = []
      for (const [projectKey, group] of byProject) {
        const displayName = group[0]?.payload.project_display_name ?? projectKey
        const { data, error } = await serviceClient.rpc('memory_sync_push', {
          p_user_id: userId,
          p_device_id: tokenRow.device_id,
          p_project_key: projectKey,
          p_display_name: displayName,
          p_remote_url: null,
          p_mutations: group.map((m) => m.payload),
        })
        if (error) {
          if (error.code === '42501') return json({ error: 'plan_required' }, 403)
          throw error
        }
        allResults.push(...(data.results ?? []))
      }
      return json({ results: allResults })
    }

    if (action === 'pull') {
      const body = await req.json()
      const cursors = (body.cursors ?? {}) as Record<string, number>
      const limit = body.limit ?? 500

      const { data: projects } = await serviceClient.from('memory_projects').select('id, project_key').eq('owner_id', userId)
      const allRows: unknown[] = []
      const newCursors: Record<string, number> = {}

      for (const project of projects ?? []) {
        const cursor = cursors[project.project_key] ?? cursors.__account__ ?? 0
        const { data, error } = await serviceClient.rpc('memory_sync_pull', {
          p_user_id: userId,
          p_project_id: project.id,
          p_cursor: cursor,
          p_limit: limit,
        })
        if (error) {
          if (error.code === '42501') continue // no longer authorized for this project — skip, don't fail the whole pull
          throw error
        }
        allRows.push(...(data.rows ?? []))
        newCursors[project.project_key] = data.cursor
      }

      return json({ rows: allRows, cursors: newCursors, has_more: false })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json({ error: message }, 400)
  }
})
