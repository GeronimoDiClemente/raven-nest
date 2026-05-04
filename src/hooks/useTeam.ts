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
  status: 'pending' | 'active' | 'requested'
  invited_by: string
  invited_at: string
  accepted_at: string | null
}

export interface PendingInvite {
  memberId: string
  team: Team
  invitedAt: string
}

export interface PendingRequest {
  memberId: string
  team: Team
  requestedAt: string
}

interface TeamState {
  teams: Team[]
  activeTeamId: string | null
  members: TeamMember[]
  pendingInvites: PendingInvite[]
  myPendingRequests: PendingRequest[]
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
    pendingInvites: [],
    myPendingRequests: [],
    loading: true,
    userId: null,
    userEmail: null,
  })

  const activeTeam = state.teams.find(t => t.id === state.activeTeamId) ?? null

  const loadMembers = useCallback(async (teamId: string): Promise<TeamMember[]> => {
    const { data } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('invited_at', { ascending: true })
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
    const { data: memberships } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', user.id)
      .eq('status', 'active')

    const teamIds = (memberships ?? []).map((m: { team_id: string }) => m.team_id)

    let teams: Team[] = []
    if (teamIds.length > 0) {
      const { data: teamsData } = await supabase
        .from('teams')
        .select('*')
        .in('id', teamIds)
        .order('created_at', { ascending: true })
      teams = (teamsData ?? []) as Team[]
    }

    // Persist active team selection; prefer Supabase, fall back to localStorage, then first team
    let stored = localStorage.getItem(storageKey(user.id))
    // Try to load from Supabase user_preferences
    const { data: userPrefsData } = await supabase
      .from('user_preferences')
      .select('active_team_id')
      .eq('user_id', user.id)
      .maybeSingle()
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
      )
    }

    const members = activeTeamId ? await loadMembers(activeTeamId) : []

    // All pending invites for this email
    const { data: pendingRows } = await supabase
      .from('team_members')
      .select('id, invited_at, teams(*)')
      .eq('email', user.email ?? '')
      .eq('status', 'pending')
      .order('invited_at', { ascending: true })

    const pendingInvites: PendingInvite[] = (pendingRows ?? [])
      .filter((r: { teams: unknown }) => r.teams)
      .map((r: { id: string; invited_at: string; teams: unknown }) => ({
        memberId: r.id,
        team: r.teams as Team,
        invitedAt: r.invited_at,
      }))

    // My pending join requests (status='requested', user_id=me)
    const { data: requestRows } = await supabase
      .from('team_members')
      .select('id, invited_at, teams(*)')
      .eq('user_id', user.id)
      .eq('status', 'requested')
      .order('invited_at', { ascending: true })

    const myPendingRequests: PendingRequest[] = (requestRows ?? [])
      .filter((r: { teams: unknown }) => r.teams)
      .map((r: { id: string; invited_at: string; teams: unknown }) => ({
        memberId: r.id,
        team: r.teams as Team,
        requestedAt: r.invited_at,
      }))

    setState({
      teams,
      activeTeamId,
      members,
      pendingInvites,
      myPendingRequests,
      loading: false,
      userId: user.id,
      userEmail: user.email ?? null,
    })
  }, [loadMembers])

  useEffect(() => { refresh() }, [refresh])

  const switchTeam = useCallback(async (teamId: string) => {
    if (!state.userId) return
    localStorage.setItem(storageKey(state.userId), teamId)
    await supabase.from('user_preferences').upsert(
      { user_id: state.userId, active_team_id: teamId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setState(s => ({ ...s, activeTeamId: teamId, members: [] }))
    await refresh()
  }, [state.userId, refresh])

  const createTeam = useCallback(async (name: string): Promise<{ ok: boolean; error?: string }> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Not signed in' }

    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ name, owner_id: user.id })
      .select()
      .single()

    if (teamError) {
      console.error('[createTeam] insert teams error:', teamError)
      return { ok: false, error: teamError.message }
    }
    if (!team) return { ok: false, error: 'Team creation returned no row (RLS?)' }

    const { error: memberError } = await supabase.from('team_members').insert({
      team_id: team.id,
      user_id: user.id,
      email: user.email ?? '',
      role: 'leader',
      status: 'active',
      invited_by: user.id,
      accepted_at: new Date().toISOString(),
    })

    if (memberError) {
      console.error('[createTeam] insert team_members error:', memberError)
      // Roll back the team since we can't be a member
      await supabase.from('teams').delete().eq('id', team.id)
      return { ok: false, error: `Could not register you as team leader: ${memberError.message}` }
    }

    localStorage.setItem(storageKey(user.id), team.id)
    supabase.from('user_preferences').upsert(
      { user_id: user.id, active_team_id: team.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    await refresh()
    return { ok: true }
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
    await supabase.from('team_members').delete().eq('id', memberId)
    await refresh()
  }, [refresh])

  const promoteMember = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    const { error } = await supabase
      .from('team_members')
      .update({ role: 'leader' })
      .eq('id', memberId)
    if (error) return { ok: false, error: error.message }
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
    if (error) return { ok: false, error: error.message }
    await refresh()
    return { ok: true }
  }, [state.members, refresh])

  const acceptInvite = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    if (!state.userId) return { ok: false, error: 'Not signed in' }
    const { error } = await supabase.rpc('accept_invite', { p_member_id: memberId })
    if (error) {
      console.error('[acceptInvite] error:', error)
      return { ok: false, error: error.message.replace(/^.*?:\s*/, '') }
    }
    await refresh()
    return { ok: true }
  }, [state.userId, refresh])

  const rejectInvite = useCallback(async (memberId: string): Promise<void> => {
    const { error } = await supabase.rpc('decline_invite', { p_member_id: memberId })
    if (error) console.error('[rejectInvite] error:', error)
    await refresh()
  }, [refresh])

  const requestJoin = useCallback(async (code: string): Promise<{ ok: boolean; teamName?: string; error?: string }> => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return { ok: false, error: 'Enter a code' }
    const { data, error } = await supabase.rpc('request_team_join', { p_code: trimmed })
    if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, '') }
    await refresh()
    const teamName = (data && typeof data === 'object' && 'team_name' in data) ? (data as { team_name: string }).team_name : undefined
    return { ok: true, teamName }
  }, [refresh])

  const cancelRequest = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    const { error } = await supabase.from('team_members').delete().eq('id', memberId)
    if (error) return { ok: false, error: error.message }
    await refresh()
    return { ok: true }
  }, [refresh])

  const approveRequest = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    const { error } = await supabase.rpc('approve_join_request', { p_member_id: memberId })
    if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, '') }
    await refresh()
    return { ok: true }
  }, [refresh])

  const declineRequest = useCallback(async (memberId: string): Promise<{ ok: boolean; error?: string }> => {
    const { error } = await supabase.rpc('decline_join_request', { p_member_id: memberId })
    if (error) return { ok: false, error: error.message.replace(/^.*?:\s*/, '') }
    await refresh()
    return { ok: true }
  }, [refresh])

  const leaveTeam = useCallback(async (): Promise<void> => {
    if (!state.userId || !activeTeam) return
    const myMember = state.members.find(m => m.user_id === state.userId)
    if (!myMember) return
    await supabase.from('team_members').delete().eq('id', myMember.id)
    // Switch to another team or clear
    const remaining = state.teams.filter(t => t.id !== activeTeam.id)
    if (remaining.length > 0) localStorage.setItem(storageKey(state.userId), remaining[0].id)
    else localStorage.removeItem(storageKey(state.userId))
    await refresh()
  }, [state.userId, state.members, state.teams, activeTeam, refresh])

  const deleteTeam = useCallback(async (): Promise<void> => {
    if (!activeTeam) return
    await supabase.from('teams').delete().eq('id', activeTeam.id)
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
    pendingInvites: state.pendingInvites,
    myPendingRequests: state.myPendingRequests,
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
    requestJoin,
    cancelRequest,
    approveRequest,
    declineRequest,
    leaveTeam,
    deleteTeam,
  }
}
