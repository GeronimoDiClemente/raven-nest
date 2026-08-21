export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

// Price IDs from Stripe dashboard → Products → [product] → Prices.
// Enterprise has no self-serve checkout — sales-led, invoiced manually.
export const STRIPE_PRICES = {
  pro_monthly:  'price_1TJmwsJarRYFmNbKh7G6JXnF',  // $20/mo
  pro_annual:   'price_1TbX45JarRYFmNbKXYSBT3Yn',  // $180/yr ($15/mo) — 25% off
  team_monthly: 'price_1TJmyRJarRYFmNbKeiOLrXss',  // $35/mo
  team_annual:  'price_1TbX66JarRYFmNbKqTA1AoEA',  // $312/yr ($26/mo) — 25% off
}

export type Plan = 'free' | 'pro' | 'team' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'

export interface PlanPricing {
  monthly: number
  annual: number  // per-month equivalent when paid yearly
}

// Source of truth for prices shown in UI and comms. Stripe Price IDs above must
// match these numbers; if you change one, change the other in the dashboard.
export const PLAN_PRICING: Record<'pro' | 'team', PlanPricing> = {
  pro:  { monthly: 20, annual: 15 },
  team: { monthly: 35, annual: 26 },
}

export const ANNUAL_DISCOUNT_PERCENT = 25
export const ENTERPRISE_MIN_SEATS = 4
export const ENTERPRISE_FLOOR_PER_SEAT = 60  // $/seat/mo, annual billing
export const TEAM_MIN_SEATS = 2
export const ENTERPRISE_CONTACT_EMAIL = 'bautista@nestmux.com'

// Enterprise is sales-led: the in-app modal links out to a demo booking instead
// of showing a card.
export const BOOK_DEMO_URL = 'https://calendly.com/matias-nestmux/new-meeting'

export interface PlanLimits {
  // Hard caps
  maxPanes: number

  // AI access
  allowedAIs: string[]

  // Productivity features
  allowBroadcast: boolean
  allowVoice: boolean
  allowSharing: boolean
  allowSnippets: boolean
  allowWorkspaces: boolean

  // Worktrees & git
  allowCreateWorktree: boolean
  allowSpotlight: boolean
  allowDiffViewer: boolean

  // Repo integrations
  allowMyRepos: boolean
  allowActions: boolean
  allowGitHubGitLab: boolean

  // MCP
  allowMcpWrite: boolean

  // Team
  allowTeam: boolean

  // Enterprise meta
  isEnterprise: boolean
}

const ALL_AIS = ['claude', 'gemini', 'codex', 'copilot', 'opencode', 'deepseek', 'grok', 'qwen', 'aider', 'cursor', 'terminal', 'custom', 'browser']

const FULL_FEATURES: Omit<PlanLimits, 'allowTeam' | 'isEnterprise'> = {
  maxPanes: 12,
  allowedAIs: ALL_AIS,
  allowBroadcast: true,
  allowVoice: true,
  allowSharing: true,
  allowSnippets: true,
  allowWorkspaces: true,
  allowCreateWorktree: true,
  allowSpotlight: true,
  allowDiffViewer: true,
  allowMyRepos: true,
  allowActions: true,
  allowGitHubGitLab: true,
  allowMcpWrite: true,
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxPanes: 3,
    allowedAIs: ALL_AIS,
    allowBroadcast: false,
    allowVoice: false,
    allowSharing: false,
    allowSnippets: false,
    allowWorkspaces: false,
    allowCreateWorktree: false,
    allowSpotlight: false,
    allowDiffViewer: false,
    allowMyRepos: false,
    allowActions: false,
    allowGitHubGitLab: false,
    allowMcpWrite: false,
    allowTeam: false,
    isEnterprise: false,
  },
  pro: {
    ...FULL_FEATURES,
    allowTeam: false,
    isEnterprise: false,
  },
  team: {
    ...FULL_FEATURES,
    allowTeam: true,
    isEnterprise: false,
  },
  enterprise: {
    ...FULL_FEATURES,
    allowTeam: true,
    isEnterprise: true,
  },
}
