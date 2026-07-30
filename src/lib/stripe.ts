// ─── Stripe Configuration ────────────────────────────────────────────────────
// TODO: Replace all placeholder values with real ones from your Stripe dashboard

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

// Price IDs from Stripe dashboard → Products → [product] → Prices
export const STRIPE_PRICES = {
  pro_monthly:  'price_1TJmwsJarRYFmNbKh7G6JXnF',
  pro_annual:   'price_1TJmy8JarRYFmNbKeScj4mwX',
  team_monthly: 'price_1TJmyRJarRYFmNbKeiOLrXss',
  team_annual:  'price_1TJmyyJarRYFmNbKq9mRgrdz',
}

export type Plan = 'free' | 'pro' | 'team'

export interface PlanLimits {
  maxRows: number
  maxCols: number
  allowedAIs: string[]
  allowBroadcast: boolean
  allowSnippets: boolean
  allowWorkspaces: boolean
  allowTeam: boolean
  // Nest Memory — docs/nest-memory-architecture.md §7.1
  memoryLocal: boolean          // always true — Free keeps full local memory (the demo, §7.1)
  memoryCloud: boolean          // Pro+: replication + multi-device
  memoryTeamShare: boolean      // Team only: promote to team scope (Phase 3)
  maxMemoryProjects: number     // free: Infinity (local, unlimited), pro: 50, team: 200
  maxCloudObservations: number  // pro: 50_000, team: 250_000 — soft caps, warn at 80%
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxRows: 2,
    maxCols: 2,
    allowedAIs: ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom', 'browser'],
    allowBroadcast: false,
    allowSnippets: false,
    allowWorkspaces: false,
    allowTeam: false,
    memoryLocal: true,
    memoryCloud: false,
    memoryTeamShare: false,
    maxMemoryProjects: Infinity,
    maxCloudObservations: 0,
  },
  pro: {
    maxRows: 4,
    maxCols: 4,
    allowedAIs: ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom', 'browser'],
    allowBroadcast: true,
    allowSnippets: true,
    allowWorkspaces: true,
    allowTeam: false,
    memoryLocal: true,
    memoryCloud: true,
    memoryTeamShare: false,
    maxMemoryProjects: 50,
    maxCloudObservations: 50_000,
  },
  team: {
    maxRows: 4,
    maxCols: 4,
    allowedAIs: ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom', 'browser'],
    allowBroadcast: true,
    allowSnippets: true,
    allowWorkspaces: true,
    allowTeam: true,
    memoryLocal: true,
    memoryCloud: true,
    memoryTeamShare: true,
    maxMemoryProjects: 200,
    maxCloudObservations: 250_000,
  },
}
