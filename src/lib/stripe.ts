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
  },
  pro: {
    maxRows: 4,
    maxCols: 4,
    allowedAIs: ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom', 'browser'],
    allowBroadcast: true,
    allowSnippets: true,
    allowWorkspaces: true,
    allowTeam: false,
  },
  team: {
    maxRows: 4,
    maxCols: 4,
    allowedAIs: ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'terminal', 'custom', 'browser'],
    allowBroadcast: true,
    allowSnippets: true,
    allowWorkspaces: true,
    allowTeam: true,
  },
}
