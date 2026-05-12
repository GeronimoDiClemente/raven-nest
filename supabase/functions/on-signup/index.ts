import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Only allow POST from Supabase Auth hooks / client SDK
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const payload = await req.json()
  const userId: string = payload.user?.id
  const email: string = payload.user?.email ?? ''

  // Get real IP (Supabase passes it via headers)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null

  if (!userId) return new Response('Missing user id', { status: 400, headers: corsHeaders })

  // Check if another account with this IP already used a trial
  if (ip) {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, plan, trial_started_at')
      .eq('signup_ip', ip)
      .not('id', 'eq', userId)
      .not('trial_started_at', 'is', null)
      .limit(1)

    if (existing && existing.length > 0) {
      // IP already used a trial — create profile without trial (only if new user)
      const { data: hasProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
      if (!hasProfile) {
        await supabase.from('profiles').insert(
          { id: userId, plan: 'free', signup_ip: ip, trial_started_at: null }
        )
      }
      return new Response(JSON.stringify({ message: 'ok' }), {
        status: 200,
        headers: jsonHeaders,
      })
    }
  }

  // New IP — create profile with trial (only if no profile exists yet)
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  if (!existing) {
    await supabase.from('profiles').insert(
      { id: userId, plan: 'free', signup_ip: ip, trial_started_at: new Date().toISOString() }
    )
  }

  return new Response(JSON.stringify({ message: 'ok' }), {
    status: 200,
    headers: jsonHeaders,
  })
})
