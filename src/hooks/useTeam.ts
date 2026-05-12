import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface Team {
  id: string
  name: string
  owner_id: string
  created_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string | null
  email: string
  role: 'leader' | 'member'
  status: 'pending' | 'active'
  invited_by: string
  invited_at: string
  accepted_at: string | null
}

interface TeamState {
  teams: Team[]
  activeTeamId: string | null
  members: TeamMember[]
  pendingInvite: { team: Team; memberId: string } | null
  loading: boolean
  userId: string | null
  userEmail: string | null
}

const STORAGE_KEY_PREFIX = 'raven_active_team_id'
const storageKey = (uid: string) => `${STORAGE_KEY_PREFIX}:${uid}`

export function useTeam() {
  const [state, setState] = useState<TeamState>({
    teams: [],
    activeTeamId: null,
    members: [],
    pendingInvite: null,
    loading: true,
    userId: null,
    userEmail: null,
  })

  const activeTeam = state.teams.find(t => t.id === state.activeTeamId) ?? null

  const loadMembers = useCallback(async (teamId: string): Promise<TeamMember[] | null> => {
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('invited_at', { ascending: true })
    if (error) {
      console.warn('[useTeam.loadMembers] select team_members failed', { teamId }, error)
      return null
    }
    return (data ?? []) as TeamMember[]
  }, [])

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setState(s => ({ ...s, loading: false }))
      return
    }

    // All active memberships
    const { data: memberships, error: membershipsError } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (membershipsError) {
      console.warn('[useTeam.refresh] select team_members (memberships) failed; keeping previous state', { userId: user.id }, membershipsError)
      setState(s => ({ ...s, loading: false, userId: user.id, userEmail: user.email ?? null }))
      return
    }

    const teamIds = (memberships ?? []).map((m: { team_id: string }) => m.team_id)

    let teams: Team[] = []
    if (teamIds.length > 0) {
      const { data: teamsData, error: teamsError } = await supabase
        .from('teams')
        .select('*')
        .in('id', teamIds)
        .order('created_at', { ascending: true })
      if (teamsError) {
        console.warn('[useTeam.refresh] select teams failed; keeping previous state', { teamIds }, teamsError)
        setState(s => ({ ...s, loading: false, userId: user.id, userEmail: user.email ?? null }))
        return
      }
      teams = (teamsData ?? []) as Team[]
    }

    // Persist active team selection; prefer Supabase, fall back to localStorage, then first team
    let stored = localStorage.getItem(storageKey(user.id))
    // Try to load from Supabase user_preferences
    const { data: userPrefsData, error: userPrefsError } = await supabase
      .from('user_preferences')
      .select('active_team_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (userPrefsError) {
      console.warn('[useTeam.refresh] select user_preferences failed; falling back to localStorage', { userId: user.id }, userPrefsError)
    }
    if (userPrefsData?.active_team_id) {
      stored = userPrefsData.active_team_id
    }
    const activeTeamId = (stored && teams.find(t => t.id === stored))
      ? stored
      : (teams[0]?.id ?? null)

    if (activeTeamId) {
      localStorage.setItem(storageKey(user.id), activeTeamId)
      supabase.from('user_preferences').upsert(
        { user_id: user.id, active_team_id: activeTeamId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      ).then(({ error }) => {
        if (error) console.warn('[useTeam.refresh] upsert user_preferences failed', { userId: user.id, activeTeamId }, error)
      })
    }

    const loadedMembers = activeTeamId ? await loadMembers(activeTeamId) : []

    // Pending invite (first one)
    const { data: pending, error: pendingError } = await supabase
      .from('team_members')
      .select('id, teams(*)')
      .eq('email', user.email ?? '')
      .eq('status', 'pending')
      .maybeSingle()
    if (pendingError) {
      console.warn('[useTeam.refresh] select pending team_members failed', { email: user.email }, pendingError)
    }

    setState(s => ({
      teams,
      activeTeamId,
      // If loadMembers returned null (RLS / network error), keep previous members list to avoid flicker-to-empty.
      members: loadedMembers ?? s.members,
      pendingInvite: pending
        ? { team: (pending.teams as unknown as Team), memberId: pending.id }
        : (pendingError ? s.pendingInvite : null),
      loading: false,
      userId: user.id,
      userEmail: user.email ?? null,
    }))
  }, [loadMembers])

  useEffect(() => { refresh() }, [refresh])

  const switchTeam = useCallback(async (teamId: string) => {
    if (!state.userId) return
    localStorage.setItem(storageKey(state.userId), teamId)
    const { error } = await supabase.from('user_preferences').upsert(
      { user_id: state.userId, active_team_id: teamId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    if (error) console.warn('[useTeam.switchTeam] upsert user_preferences failed', { userId: state.userId, teamId }, error)
    setState(s => ({ ...s, activeTeamId: teamId, members: [] }))
    await refresh()
  }, [state.userId, refresh])

  const createTeam = useCallback(async (name: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data: team, error } = await supabase
      .from('teams')
      .insert({ name, owner_id: user.id })
      .select()
      .single()

    if (error || !team) {
      if (error) console.warn('[useTeam.createTeam] insert teams failed', { name }, error)
      return false
    }

    const { error: memberError } = await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: user.id,
      email: user.email ?? '',
      role: 'leader',
      status: 'active',
      invited_by: user.id,
      accepted_at: new Date().toISOString(),
    })
    if (memberError) console.warn('[useTeam.createTeam] insert team_members (self) failed', { teamId: team.id }, memberError)

    localStorage.setItem(storageKey(user.id), team.id)
    supabase.from('user_preferences').upsert(
      { user_id: user.id, active_team_id: team.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    ).then(({ error: prefError }) => {
      if (prefError) console.warn('[useTeam.createTeam] upsert user_preferences failed', { userId: user.id, teamId: team.id }, prefError)
    })
    await refresh()
    return true
  }, [refresh])

  const inviteMember = useCallback(async (email: string): Promise<{ ok: boolean; error?: string }> => {
    if (!activeTeam || !state.userId) return { ok: false, error: 'No team' }

    const { error } = await supabase.from('team_members').insert({
      team_id: activeTeam.id,
      user_id: null,
      email,
      role: 'member',
      status: 'pending',
      invited_by: state.userId,
    })

    if (error?.code === '23505') return { ok: false, error: 'Already invited' }
    if (error) return { ok: false, error: error.message }

    // Fire-and-forget email notification (fails silently if not configured)
    supabase.auth.getSession().then(({ data: { session } }) => {
      supabase.functions.invoke('send-invite-email', {
        body: { toEmail: email, teamName: activeTeam.name, inviterEmail: state.userEmail },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      }).then(({ data, error }) => {
        if (error) console.error('[send-invite-email] error:', error)
        else console.log('[send-invite-email] result:', data)
      }).catch(e => console.error('[send-invite-email] catch:', e))
    })

    await refresh()
    return { ok: true }
  }, [activeTeam, state.userId, state.userEmail, refresh])

  const removeMember = useCallback(async (memberId: string): Promise<void> => {
    const { error } = await supabase.from('team_members').delete().eq('id', memberId)
    if (error) console.warn('[useTeam.removeMember] delete failed', { memberId }, error)
    await refresh()
  }, [refresh])

  const promoteMember = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    const { error } = await supabase
      .from('team_members')
      .update({ role: 'leader' })
      .eq('id', memberId)
    if (error) {
      console.warn('[useTeam.promoteMember] update failed', { memberId }, error)
      return { ok: false, error: error.message }
    }
    await refresh()
    return { ok: true }
  }, [refresh])

  const demoteMember = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    // Block demotion if it would leave the team without any leader
    const leaders = state.members.filter(m => m.role === 'leader' && m.status === 'active')
    const target = state.members.find(m => m.id === memberId)
    if (target?.role === 'leader' && leaders.length <= 1) {
      return { ok: false, error: 'Cannot remove the last team leader' }
    }
    const { error } = await supabase
      .from('team_members')
      .update({ role: 'member' })
      .eq('id', memberId)
    if (error) {
      console.warn('[useTeam.demoteMember] update failed', { memberId }, error)
      return { ok: false, error: error.message }
    }
    await refresh()
    return { ok: true }
  }, [state.members, refresh])

  const acceptInvite = useCallback(async (): Promise<boolean> => {
    if (!state.pendingInvite || !state.userId) return false
    const { error } = await supabase
      .from('team_members')
      .update({ status: 'active', accepted_at: new Date().toISOString(), user_id: state.userId })
      .eq('id', state.pendingInvite.memberId)
    if (error) {
      console.warn('[useTeam.acceptInvite] update failed', { memberId: state.pendingInvite.memberId }, error)
      return false
    }
    await refresh()
    return true
  }, [state.pendingInvite, state.userId, refresh])

  const rejectInvite = useCallback(async (): Promise<void> => {
    if (!state.pendingInvite) return
    const memberId = state.pendingInvite.memberId
    const { error } = await supabase.from('team_members').delete().eq('id', memberId)
    if (error) console.warn('[useTeam.rejectInvite] delete failed', { memberId }, error)
    await refresh()
  }, [state.pendingInvite, refresh])

  const leaveTeam = useCallback(async (): Promise<void> => {
    if (!state.userId || !activeTeam) return
    const myMember = state.members.find(m => m.user_id === state.userId)
    if (!myMember) return
    const { error } = await supabase.from('team_members').delete().eq('id', myMember.id)
    if (error) console.warn('[useTeam.leaveTeam] delete failed', { memberId: myMember.id }, error)
    // Switch to another team or clear
    const remaining = state.teams.filter(t => t.id !== activeTeam.id)
    if (remaining.length > 0) localStorage.setItem(storageKey(state.userId), remaining[0].id)
    else localStorage.removeItem(storageKey(state.userId))
    await refresh()
  }, [state.userId, state.members, state.teams, activeTeam, refresh])

  const deleteTeam = useCallback(async (): Promise<void> => {
    if (!activeTeam) return
    const { error } = await supabase.from('teams').delete().eq('id', activeTeam.id)
    if (error) console.warn('[useTeam.deleteTeam] delete failed', { teamId: activeTeam.id }, error)
    const remaining = state.teams.filter(t => t.id !== activeTeam.id)
    if (remaining.length > 0) localStorage.setItem(storageKey(state.userId!), remaining[0].id)
    else localStorage.removeItem(storageKey(state.userId!))
    await refresh()
  }, [activeTeam, state.teams, state.userId, refresh])

  return {
    teams: state.teams,
    team: activeTeam,          // backwards compat alias
    activeTeam,
    activeTeamId: state.activeTeamId,
    members: state.members,
    pendingInvite: state.pendingInvite,
    loading: state.loading,
    userId: state.userId,
    userEmail: state.userEmail,
    switchTeam,
    refresh,
    createTeam,
    inviteMember,
    removeMember,
    promoteMember,
    demoteMember,
    acceptInvite,
    rejectInvite,
    leaveTeam,
    deleteTeam,
  }
}
