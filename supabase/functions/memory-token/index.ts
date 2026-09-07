// Supabase Edge Function — Nest Memory token lifecycle (issue/list/revoke/rotate)
// Design: docs/nest-memory-architecture.md §6.1.
// Deploy: supabase functions deploy memory-token
// Requires SUPABASE_SERVICE_ROLE_KEY (never sent to the client — service-role writes
// stay server-side, same pattern the rest of this project's edge functions use).
//
// UNVERIFIED IN THIS ENVIRONMENT — no Docker/supabase CLI available to `functions serve`
// and exercise this against a real project. Written to spec; needs a local-stack pass
// before shipping (see docs/nest-memory-architecture.md §9 Phase 1 "Local test plan").

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

function base64url(bytes: Uint8Array): string {
  let str = btoa(String.fromCharCode(...bytes))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `nmk_${base64url(bytes)}`
}

// Reuses the single-source-of-truth `user_has_plan` SQL function (20260502120100_
// plan_gates_rls.sql) rather than duplicating plan logic here — same helper the RPCs in
// the memory migration call server-side.
// deno-lint-ignore no-explicit-any
async function userHasPlan(client: any, userId: string, allowed: string[]): Promise<boolean> {
  const { data, error } = await client.rpc('user_has_plan', { uid: userId, allowed })
  if (error) return false
  return data === true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401)

    // Caller identity comes from the user's normal Supabase JWT — same pattern as
    // github-oauth. This function issues/manages tokens; it does NOT accept an nmk_
    // token itself (that's memory-sync's job, §6.1 distinguishes the two paths).
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return json({ error: 'Not authenticated' }, 401)

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse the body exactly once — a Fetch API Request body can only be read once;
    // `revoke`/`rotate` previously called `req.json()` a second time further down,
    // which throws "Body already consumed" in Deno and made both actions unconditionally
    // fail (caught by the outer try/catch as a generic 400). Destructure every field
    // any action needs from this single parse instead.
    const { action, device, tokenId, all } = await req.json()

    if (action === 'issue') {
      if (!device?.name || !device?.platform) return json({ error: 'device.name and device.platform are required' }, 400)
      // 'enterprise' added on main after this file was first written — see O-9 in
      // docs/nest-memory-architecture.md §10. Without it here, an enterprise account
      // would be silently refused a memory token at all.
      if (!(await userHasPlan(serviceClient, user.id, ['pro', 'team', 'enterprise']))) {
        return json({ error: 'plan_required' }, 403)
      }

      // One device row per (user, name) — reissuing for the same machine updates it
      // rather than accumulating duplicates.
      const { data: existingDevice } = await serviceClient
        .from('memory_devices')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', device.name)
        .maybeSingle()

      let deviceId: string
      if (existingDevice) {
        deviceId = existingDevice.id
        await serviceClient.from('memory_devices').update({ last_seen_at: new Date().toISOString(), app_version: device.appVersion ?? null }).eq('id', deviceId)
      } else {
        const { data: created, error } = await serviceClient
          .from('memory_devices')
          .insert({ user_id: user.id, name: device.name, platform: device.platform, app_version: device.appVersion ?? null })
          .select('id')
          .single()
        if (error) throw error
        deviceId = created.id
      }

      const { data: profile } = await serviceClient.from('profiles').select('memory_token_epoch').eq('id', user.id).maybeSingle()

      const plaintext = generateToken()
      const tokenHash = await sha256Hex(plaintext)
      const tokenPrefix = plaintext.slice(0, 10) // "nmk_" + first 6 chars

      const { data: tokenRow, error: tokenError } = await serviceClient
        .from('memory_tokens')
        .insert({ user_id: user.id, device_id: deviceId, token_hash: tokenHash, token_prefix: tokenPrefix, minted_epoch: profile?.memory_token_epoch ?? 0 })
        .select('id')
        .single()
      if (tokenError) throw tokenError

      // Plaintext returned exactly once — never stored, never re-derivable (§6.1, §6.3).
      return json({ token: plaintext, device_id: deviceId, token_id: tokenRow.id })
    }

    if (action === 'list') {
      const { data, error } = await serviceClient
        .from('memory_tokens_public')
        .select('id, device_id, token_prefix, last_used_at, revoked_at, memory_devices(name, platform, last_seen_at)')
        .eq('user_id', user.id)
      if (error) throw error
      return json({ tokens: data })
    }

    if (action === 'revoke') {
      if (all) {
        const { error } = await serviceClient.from('memory_tokens').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null)
        if (error) throw error
      } else if (tokenId) {
        const { error } = await serviceClient.from('memory_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenId).eq('user_id', user.id)
        if (error) throw error
      } else {
        return json({ error: 'tokenId or all is required' }, 400)
      }
      return json({ ok: true })
    }

    if (action === 'rotate') {
      if (!tokenId) return json({ error: 'tokenId is required' }, 400)
      const { data: old, error: fetchError } = await serviceClient.from('memory_tokens').select('device_id').eq('id', tokenId).eq('user_id', user.id).single()
      if (fetchError || !old) return json({ error: 'Token not found' }, 404)

      await serviceClient.from('memory_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenId)

      // M14 fix: this previously omitted minted_epoch entirely (defaulting to 0), so any
      // user whose epoch had already been bumped past 0 (e.g. by a past team removal,
      // §6.4) got a token that memory-sync's epoch check rejects as stale on its very
      // first use — "rotate" silently minted a dead token.
      const { data: profile } = await serviceClient.from('profiles').select('memory_token_epoch').eq('id', user.id).maybeSingle()

      const plaintext = generateToken()
      const tokenHash = await sha256Hex(plaintext)
      const { data: created, error } = await serviceClient
        .from('memory_tokens')
        .insert({ user_id: user.id, device_id: old.device_id, token_hash: tokenHash, token_prefix: plaintext.slice(0, 10), minted_epoch: profile?.memory_token_epoch ?? 0 })
        .select('id')
        .single()
      if (error) throw error
      return json({ token: plaintext, token_id: created.id })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err: unknown) {
    console.error('memory-token error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json({ error: message }, 400)
  }
})
